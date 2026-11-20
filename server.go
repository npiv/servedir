package main

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const previewLimit = 2 << 20

type app struct {
	root     *os.Root
	rootPath string
	assets   http.Handler
}

type entry struct {
	Name       string     `json:"name"`
	Path       string     `json:"path"`
	Kind       string     `json:"kind"`
	Size       *int64     `json:"size"`
	Modified   *time.Time `json:"modified"`
	Created    *time.Time `json:"created"`
	Symlink    bool       `json:"symlink"`
	Accessible bool       `json:"accessible"`
}

func newApp(root *os.Root, rootPath string) *app {
	assets, err := fs.Sub(webAssets, "web/dist")
	if err != nil {
		panic(err)
	}
	return &app{root: root, rootPath: rootPath, assets: http.FileServer(http.FS(assets))}
}

func (a *app) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
	if !localHost(r.Host) {
		jsonError(w, http.StatusForbidden, "Use the localhost address printed in your terminal.")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Scheme != "http" || u.Host != r.Host {
			jsonError(w, http.StatusForbidden, "Cross-origin requests are not allowed.")
			return
		}
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		jsonError(w, http.StatusForbidden, "Open servedir directly using its localhost address.")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		jsonError(w, http.StatusMethodNotAllowed, "This server is read-only.")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	switch r.URL.Path {
	case "/api/list":
		a.list(w, r)
	case "/api/info":
		a.info(w, r)
	case "/api/preview":
		a.preview(w, r)
	case "/file", "/download":
		a.file(w, r)
	case "/":
		a.assets.ServeHTTP(w, r)
	default:
		if strings.HasPrefix(r.URL.Path, "/assets/") || r.URL.Path == "/favicon.svg" {
			w.Header().Set("Cache-Control", "public, max-age=3600")
			a.assets.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	}
}

func localHost(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func requestPath(r *http.Request) (string, error) {
	p := r.URL.Query().Get("path")
	if p == "" || p == "." {
		return ".", nil
	}
	if strings.ContainsAny(p, "\\\x00") || path.IsAbs(p) {
		return "", fs.ErrPermission
	}
	for _, part := range strings.Split(p, "/") {
		if part == ".." {
			return "", fs.ErrPermission
		}
	}
	return path.Clean(p), nil
}

func (a *app) describe(rel string, info os.FileInfo, parent *os.File, name string, symlink bool) entry {
	modified := info.ModTime().UTC()
	e := entry{Name: info.Name(), Path: rel, Kind: "file", Modified: &modified, Accessible: true, Symlink: symlink}
	if rel == "." {
		e.Name = filepath.Base(a.rootPath)
		e.Path = ""
	}
	if info.IsDir() {
		e.Kind = "directory"
	} else if info.Mode().IsRegular() {
		size := info.Size()
		e.Size = &size
	} else {
		e.Kind = "special"
		e.Accessible = false
	}
	if !symlink {
		e.Created = birthTime(parent, name, info)
	}
	return e
}

func (a *app) list(w http.ResponseWriter, r *http.Request) {
	rel, err := requestPath(r)
	if err != nil {
		fileError(w, err)
		return
	}
	stat, err := a.root.Stat(rel)
	if err != nil {
		fileError(w, err)
		return
	}
	if !stat.IsDir() {
		jsonError(w, http.StatusBadRequest, "This path is not a directory.")
		return
	}
	dir, err := openNonblocking(a.root, rel)
	if err != nil {
		fileError(w, err)
		return
	}
	defer dir.Close()
	info, err := dir.Stat()
	if err != nil {
		fileError(w, err)
		return
	}
	if !info.IsDir() {
		jsonError(w, http.StatusBadRequest, "This path is not a directory.")
		return
	}
	items, err := dir.ReadDir(100001)
	if err != nil && !errors.Is(err, io.EOF) {
		fileError(w, err)
		return
	}
	if len(items) > 100000 {
		jsonError(w, http.StatusUnprocessableEntity, "This directory has more than 100,000 entries. Open a smaller directory.")
		return
	}
	entries := make([]entry, 0, len(items))
	for _, item := range items {
		p := path.Join(rel, item.Name())
		symlink := item.Type()&os.ModeSymlink != 0
		stat, err := a.root.Stat(p)
		if err != nil {
			entries = append(entries, entry{Name: item.Name(), Path: p, Kind: "unavailable", Symlink: symlink, Accessible: false})
			continue
		}
		e := a.describe(p, stat, dir, item.Name(), symlink)
		e.Name = item.Name()
		entries = append(entries, e)
	}
	if rel == "." {
		rel = ""
	}
	jsonResponse(w, map[string]any{"entries": entries, "path": rel, "rootName": filepath.Base(a.rootPath), "rootPath": a.rootPath, "version": version})
}

func (a *app) info(w http.ResponseWriter, r *http.Request) {
	rel, err := requestPath(r)
	if err != nil {
		fileError(w, err)
		return
	}
	info, err := a.root.Stat(rel)
	if err != nil {
		fileError(w, err)
		return
	}
	linkInfo, err := a.root.Lstat(rel)
	if err != nil {
		fileError(w, err)
		return
	}
	parent, err := a.root.Open(path.Dir(rel))
	if err != nil {
		fileError(w, err)
		return
	}
	defer parent.Close()
	e := a.describe(rel, info, parent, path.Base(rel), linkInfo.Mode()&os.ModeSymlink != 0)
	e.Name = path.Base(rel)
	if rel == "." {
		e.Name = filepath.Base(a.rootPath)
	}
	jsonResponse(w, e)
}

func (a *app) openFile(r *http.Request) (*os.File, os.FileInfo, error) {
	rel, err := requestPath(r)
	if err != nil {
		return nil, nil, err
	}
	info, err := a.root.Stat(rel)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, fs.ErrPermission
	}
	f, err := openNonblocking(a.root, rel)
	if err != nil {
		return nil, nil, err
	}
	info, err = f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, nil, fs.ErrPermission
	}
	return f, info, nil
}

func (a *app) preview(w http.ResponseWriter, r *http.Request) {
	f, info, err := a.openFile(r)
	if err != nil {
		fileError(w, err)
		return
	}
	defer f.Close()
	if info.Size() > previewLimit {
		jsonError(w, http.StatusRequestEntityTooLarge, "This file is larger than the 2 MiB text preview limit. Download it to read the whole file.")
		return
	}
	data, err := io.ReadAll(io.LimitReader(f, previewLimit+1))
	if err != nil {
		fileError(w, err)
		return
	}
	if len(data) > previewLimit {
		jsonError(w, http.StatusRequestEntityTooLarge, "This file is too large to preview.")
		return
	}
	if !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
		jsonError(w, http.StatusUnsupportedMediaType, "This file has no text preview. You can download the original.")
		return
	}
	jsonResponse(w, map[string]string{"content": string(data)})
}

func (a *app) file(w http.ResponseWriter, r *http.Request) {
	f, info, err := a.openFile(r)
	if err != nil {
		fileError(w, err)
		return
	}
	defer f.Close()
	ext := strings.ToLower(filepath.Ext(info.Name()))
	contentType := mime.TypeByExtension(ext)
	disposition := "inline"
	if r.URL.Path == "/download" {
		disposition = "attachment"
		contentType = "application/octet-stream"
	} else if !strings.HasPrefix(contentType, "image/") && !strings.HasPrefix(contentType, "audio/") && !strings.HasPrefix(contentType, "video/") && contentType != "application/pdf" {
		contentType = "text/plain; charset=utf-8"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": info.Name()}))
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

func jsonResponse(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(value)
}

func jsonError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
}

func fileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		jsonError(w, http.StatusNotFound, "This file or directory no longer exists.")
	case errors.Is(err, fs.ErrPermission), strings.Contains(err.Error(), "escapes from parent"):
		jsonError(w, http.StatusForbidden, "This path is unavailable or outside the served directory.")
	default:
		jsonError(w, http.StatusForbidden, "This path could not be read. Check its permissions and symbolic links.")
	}
}
