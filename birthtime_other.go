//go:build !linux && !darwin && !windows

package main

import (
	"os"
	"time"
)

func birthTime(_ *os.File, _ string, _ os.FileInfo) *time.Time { return nil }
