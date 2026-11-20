//go:build linux || darwin

package main

import (
	"os"
	"syscall"
)

// A regular file may be replaced by a FIFO between Stat and Open. Nonblocking
// opens let the caller reject it without hanging the server.
func openNonblocking(root *os.Root, path string) (*os.File, error) {
	return root.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
}
