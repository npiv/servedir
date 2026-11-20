package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"time"
)

//go:embed all:web/dist
var webAssets embed.FS

//go:embed completions/servedir.fish
var fishCompletions string

//go:embed THIRD_PARTY_NOTICES.txt
var thirdPartyNotices string

var version = "0.1.0-dev"

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "servedir:", err)
		os.Exit(1)
	}
}

func run(args []string, out, errOut io.Writer) error {
	flags := flag.NewFlagSet("servedir", flag.ContinueOnError)
	flags.SetOutput(errOut)
	port := flags.Int("port", 8000, "localhost port (0 chooses an available port)")
	open := flags.Bool("open", false, "open the browser after starting")
	showVersion := flags.Bool("version", false, "print the version")
	showLicenses := flags.Bool("licenses", false, "print bundled open-source licenses")
	completion := flags.String("completions", "", "print shell completions (fish)")
	flags.Usage = func() {
		fmt.Fprint(errOut, "servedir — a little home for your files\n\nUsage: servedir [options] [directory]\n\nServes the current directory on localhost. Stop with Ctrl+C.\n\n")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if *showVersion {
		fmt.Fprintln(out, "servedir", version)
		return nil
	}
	if *showLicenses {
		fmt.Fprint(out, thirdPartyNotices)
		return nil
	}
	if *completion != "" {
		if *completion != "fish" {
			return fmt.Errorf("supported shell: fish")
		}
		fmt.Fprint(out, fishCompletions)
		return nil
	}
	if flags.NArg() > 1 {
		return fmt.Errorf("expected one directory; put options before the directory")
	}
	if *port < 0 || *port > 65535 {
		return fmt.Errorf("port must be between 0 and 65535")
	}
	dir := "."
	if flags.NArg() == 1 {
		dir = flags.Arg(0)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(abs)
	if err != nil {
		return fmt.Errorf("open directory: %w", err)
	}
	defer root.Close()
	explicitPort := false
	flags.Visit(func(f *flag.Flag) {
		if f.Name == "port" {
			explicitPort = true
		}
	})
	listener, err := listen(*port, !explicitPort)
	if err != nil {
		return fmt.Errorf("cannot listen on localhost port %d: %w", *port, err)
	}
	defer listener.Close()
	url := "http://" + listener.Addr().String()
	app := newApp(root, abs)
	server := &http.Server{Handler: app, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	fmt.Fprintf(out, "\n  servedir %s\n\n  Folder  %s\n  Local   %s\n\n  Press Ctrl+C to stop.\n\n", version, abs, url)
	if *open {
		if err := openBrowser(url); err != nil {
			fmt.Fprintf(errOut, "Could not open browser: %v. Open %s manually.\n", err, url)
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = server.Shutdown(shutdownCtx)
		case <-done:
		}
	}()
	err = server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func listen(port int, fallback bool) (net.Listener, error) {
	attempts := 1
	if fallback && port != 0 {
		attempts = 100
	}
	var err error
	for i := 0; i < attempts && port+i <= 65535; i++ {
		var ln net.Listener
		ln, err = net.Listen("tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(port+i)))
		if err == nil {
			return ln, nil
		}
	}
	return nil, err
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
