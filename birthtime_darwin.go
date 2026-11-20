package main

import (
	"os"
	"syscall"
	"time"
)

func birthTime(_ *os.File, _ string, info os.FileInfo) *time.Time {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		t := time.Unix(stat.Birthtimespec.Sec, stat.Birthtimespec.Nsec).UTC()
		return &t
	}
	return nil
}
