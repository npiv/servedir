package main

import (
	"os"
	"syscall"
	"time"
)

func birthTime(_ *os.File, _ string, info os.FileInfo) *time.Time {
	if stat, ok := info.Sys().(*syscall.Win32FileAttributeData); ok {
		t := time.Unix(0, stat.CreationTime.Nanoseconds()).UTC()
		return &t
	}
	return nil
}
