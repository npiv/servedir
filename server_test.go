package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) (*app, string) {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{"README.md": "# Welcome\n\n```mermaid\ngraph LR\n A-->B\n```\n", "space # café.md": "A UTF-8 document", ".hidden": "hidden", "sample.html": "<script>alert(1)</script>", "binary.bin": "a\x00b"}
	for name, value := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "notes"), 0700); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Close() })
	return newApp(root, dir), dir
}

func request(a *app, endpoint, file string) *httptest.ResponseRecorder {
	target := endpoint + "?path=" + url.QueryEscape(file)
	if endpoint == "/open/" {
		target = (&url.URL{Path: endpoint + file}).EscapedPath()
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:8000"+target, nil)
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}

func TestDirectoryAndPreview(t *testing.T) {
	a, _ := fixture(t)
	w := request(a, "/api/list", "")
	if w.Code != 200 {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	var listing struct {
		Entries []entry `json:"entries"`
		Path    string  `json:"path"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 6 || listing.Path != "" {
		t.Fatalf("unexpected listing: %+v", listing)
	}
	for _, e := range listing.Entries {
		if e.Modified == nil {
			t.Fatal("missing modification time")
		}
		if e.Kind == "directory" && e.Size != nil {
			t.Fatal("directory must not report inode size as content size")
		}
	}
	w = request(a, "/api/preview", "space # café.md")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "UTF-8") {
		t.Fatalf("encoded name: %d %s", w.Code, w.Body.String())
	}
	w = request(a, "/api/preview", "binary.bin")
	if w.Code != 415 {
		t.Fatalf("binary preview: got %d", w.Code)
	}
	w = request(a, "/api/info", "notes")
	if !strings.Contains(w.Body.String(), `"kind":"directory"`) {
		t.Fatalf("directory info: %s", w.Body.String())
	}
	w = request(a, "/api/list", "README.md")
	if w.Code != 400 {
		t.Fatalf("listing a file: %d", w.Code)
	}
}

func TestRootConfinement(t *testing.T) {
	a, dir := fixture(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("outside-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dir, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink("README.md", filepath.Join(dir, "inside.md")); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"/api/list", "/api/info", "/api/preview", "/file", "/download", "/open/"} {
		for _, p := range []string{"../secret", "notes/../../secret", "/etc/passwd", `..\secret`, "escape/secret", "bad\x00name"} {
			w := request(a, endpoint, p)
			if w.Code < 400 || strings.Contains(w.Body.String(), "outside-secret") {
				t.Errorf("escaped root via %s %q: %d", endpoint, p, w.Code)
			}
		}
	}
	w := request(a, "/api/list", "escape")
	if w.Code < 400 {
		t.Fatal("followed external directory link")
	}
	w = request(a, "/api/list", "")
	var listing struct {
		Entries []entry `json:"entries"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listing)
	for _, e := range listing.Entries {
		if e.Name == "escape" && e.Accessible {
			t.Fatal("external link marked accessible")
		}
	}
	w = request(a, "/api/preview", "inside.md")
	if w.Code != 200 {
		t.Fatalf("in-root symlink should work: %d", w.Code)
	}
	w = request(a, "/open/", "inside.md")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "# Welcome") {
		t.Fatalf("direct in-root symlink: %d %s", w.Code, w.Body.String())
	}
}

func TestRequestBoundaries(t *testing.T) {
	a, _ := fixture(t)
	tests := []struct {
		name, method, host, origin, site string
		want                             int
	}{
		{"foreign host", "GET", "evil.example:8000", "", "", 403},
		{"foreign origin", "GET", "localhost:8000", "https://evil.example", "", 403},
		{"other local port", "GET", "localhost:8000", "http://localhost:9000", "", 403},
		{"cross-site", "GET", "localhost:8000", "", "cross-site", 403},
		{"read-only", "POST", "localhost:8000", "", "", 405},
		{"same-origin", "GET", "localhost:8000", "http://localhost:8000", "same-origin", 200},
	}
	for _, endpoint := range []string{"/api/list", "/open/sample.html"} {
		for _, tt := range tests {
			t.Run(endpoint+"/"+tt.name, func(t *testing.T) {
				r := httptest.NewRequest(tt.method, "http://"+tt.host+endpoint, nil)
				r.Header.Set("Origin", tt.origin)
				r.Header.Set("Sec-Fetch-Site", tt.site)
				w := httptest.NewRecorder()
				a.ServeHTTP(w, r)
				if w.Code != tt.want {
					t.Fatalf("want %d, got %d", tt.want, w.Code)
				}
			})
		}
	}
}

func TestOpenInBrowser(t *testing.T) {
	a, dir := fixture(t)
	files := []struct {
		name, content, contentType string
	}{
		{"sample.html", "<!doctype html><h1>Hello</h1><script>window.active=true</script>", "text/html"},
		{"notes/space # café%25.HTML", "<h1>Encoded name</h1>", "text/html"},
		{"notes/site.css", "h1 { color: red; }", "text/css"},
		{"notes/site.js", "document.title = 'Hello';", "javascript"},
		{"notes/config.json", `{"name":"Hello"}`, "application/json"},
		{"notes/icon.svg", `<svg xmlns="http://www.w3.org/2000/svg"/>`, "image/svg+xml"},
		{"notes/plain.unknownextension", "plain text", "text/plain"},
	}
	for _, file := range files {
		t.Run(file.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(dir, file.name), []byte(file.content), 0600); err != nil {
				t.Fatal(err)
			}
			w := request(a, "/open/", file.name)
			if w.Code != 200 || w.Body.String() != file.content {
				t.Fatalf("original content: %d %q", w.Code, w.Body.String())
			}
			if !strings.Contains(w.Header().Get("Content-Type"), file.contentType) {
				t.Fatalf("native content type: %s", w.Header().Get("Content-Type"))
			}
			if !strings.HasPrefix(w.Header().Get("Content-Disposition"), "inline;") {
				t.Fatal("direct files should open inline")
			}
			if w.Header().Get("Content-Security-Policy") != "" {
				t.Fatal("direct files must allow native scripts and styles")
			}
		})
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		r := httptest.NewRequest(method, "http://localhost:8000/open/sample.html?path=missing&version=1", nil)
		r.Header.Set("Range", "bytes=0-8")
		w := httptest.NewRecorder()
		a.ServeHTTP(w, r)
		if w.Code != http.StatusPartialContent || w.Header().Get("Content-Length") != "9" {
			t.Fatalf("direct %s range: %d %v", method, w.Code, w.Header())
		}
		want := "<!doctype"
		if method == http.MethodHead {
			want = ""
		}
		if w.Body.String() != want {
			t.Fatalf("direct %s body: %q", method, w.Body.String())
		}
	}
	for _, name := range []string{"", "notes", "missing.html"} {
		w := request(a, "/open/", name)
		if w.Code < 400 {
			t.Fatalf("must reject unavailable files and directories: %q: %d", name, w.Code)
		}
	}
}

func TestFilesRangesAndLimits(t *testing.T) {
	a, dir := fixture(t)
	if err := os.WriteFile(filepath.Join(dir, "big.txt"), []byte(strings.Repeat("x", previewLimit+1)), 0600); err != nil {
		t.Fatal(err)
	}
	w := request(a, "/api/preview", "big.txt")
	if w.Code != 413 {
		t.Fatalf("large preview: %d", w.Code)
	}
	w = request(a, "/file", "sample.html")
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "text/plain") || !strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") {
		t.Fatal("HTML must not execute as a page")
	}
	w = request(a, "/download", "space # café.md")
	if !strings.HasPrefix(w.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatal("missing download disposition")
	}
	r := httptest.NewRequest("GET", "http://localhost:8000/file?path=README.md", nil)
	r.Header.Set("Range", "bytes=0-8")
	w = httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != http.StatusPartialContent || w.Body.String() != "# Welcome" {
		t.Fatalf("range: %d %q", w.Code, w.Body.String())
	}
	server := httptest.NewServer(a)
	defer server.Close()
	resp, err := http.Head(server.URL + "/file?path=README.md")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || len(data) != 0 {
		t.Fatal("HEAD request failed")
	}
	w = request(a, "/api/info", "missing.md")
	if w.Code != 404 {
		t.Fatalf("missing: %d", w.Code)
	}
}

func TestEmbeddedUI(t *testing.T) {
	a, _ := fixture(t)
	w := request(a, "/", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "/assets/") {
		t.Fatal("missing embedded application")
	}
}
