package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

type FileStorage interface {
	Save(storageKey string, source io.Reader) (int64, string, error)
	Delete(storageKey string) error
	Read(storageKey string) ([]byte, error)
}

type LocalFileStorage struct {
	root string
}

func NewLocalFileStorage(root string) *LocalFileStorage {
	trimmed := strings.TrimSpace(root)
	if trimmed == "" {
		trimmed = "/tmp/sxfg_uploads"
	}
	return &LocalFileStorage{root: trimmed}
}

func (storage *LocalFileStorage) Save(storageKey string, source io.Reader) (int64, string, error) {
	cleanKey := strings.TrimSpace(storageKey)
	if cleanKey == "" {
		return 0, "", fmt.Errorf("storageKey 不能为空")
	}
	fullPath := filepath.Join(storage.root, cleanKey)
	directory := filepath.Dir(fullPath)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return 0, "", err
	}

	file, err := os.Create(fullPath)
	if err != nil {
		return 0, "", err
	}
	defer file.Close()

	hasher := sha256.New()
	writtenBytes, err := io.Copy(io.MultiWriter(file, hasher), source)
	if err != nil {
		return 0, "", err
	}
	checksum := hex.EncodeToString(hasher.Sum(nil))
	return writtenBytes, checksum, nil
}

func (storage *LocalFileStorage) Delete(storageKey string) error {
	cleanKey := strings.TrimSpace(storageKey)
	if cleanKey == "" {
		return nil
	}
	fullPath := filepath.Join(storage.root, cleanKey)
	if _, err := os.Stat(fullPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return os.Remove(fullPath)
}

func (storage *LocalFileStorage) Read(storageKey string) ([]byte, error) {
	cleanKey := strings.TrimSpace(storageKey)
	if cleanKey == "" {
		return nil, fmt.Errorf("storageKey 不能为空")
	}
	fullPath := filepath.Join(storage.root, cleanKey)
	return os.ReadFile(fullPath)
}

var unsafeStorageFileNameChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitizeDisplayFileName(name string) string {
	normalized := strings.ReplaceAll(name, "\\", "/")
	base := strings.TrimSpace(filepath.Base(normalized))
	if base == "" || base == "." || base == string(filepath.Separator) {
		return "file.bin"
	}
	sanitized := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, base)
	sanitized = strings.TrimSpace(sanitized)
	sanitized = strings.NewReplacer("/", "_", "\\", "_", "\x00", "_").Replace(sanitized)
	if sanitized == "" {
		return "file.bin"
	}
	return sanitized
}

func sanitizeStorageFileName(name string) string {
	displayName := sanitizeDisplayFileName(name)
	sanitized := unsafeStorageFileNameChars.ReplaceAllString(displayName, "_")
	sanitized = strings.Trim(sanitized, "._")
	if sanitized == "" {
		return "file"
	}
	return sanitized
}
