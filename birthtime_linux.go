package main

import (
	"golang.org/x/sys/unix"
	"os"
	"time"
)

func birthTime(parent *os.File, name string, _ os.FileInfo) *time.Time {
	var stat unix.Statx_t
	if err := unix.Statx(int(parent.Fd()), name, unix.AT_SYMLINK_NOFOLLOW, unix.STATX_BTIME, &stat); err != nil || stat.Mask&unix.STATX_BTIME == 0 {
		return nil
	}
	t := time.Unix(stat.Btime.Sec, int64(stat.Btime.Nsec)).UTC()
	return &t
}
