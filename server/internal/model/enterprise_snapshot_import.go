package model

import "encoding/json"

type EnterpriseSnapshotExtension struct {
	SourceSnapshotID   string `json:"sourceSnapshotId"`
	RawEntpJSON        string `json:"rawEntpJson"`
	NormalizedExtraJSON string `json:"normalizedExtraJson"`
}

type SnapshotFieldStats struct {
	Written         int `json:"written"`
	Skipped         int `json:"skipped"`
	ConvertFailures int `json:"convertFailures"`
}

type EnterpriseSnapshotImportResult struct {
	EnterpriseID int64                `json:"enterpriseId"`
	Created      bool                 `json:"created"`
	Updated      bool                 `json:"updated"`
	Conflicts    []ConflictDifference `json:"conflicts"`
	FieldStats   SnapshotFieldStats   `json:"fieldStats"`
	Warnings     []string             `json:"warnings"`
}

type SnapshotEntpImportRequest struct {
	SnapshotID string          `json:"snapshotId"`
	Snapshot   json.RawMessage `json:"snapshot"`
	DryRun     bool            `json:"dryRun"`
	Confirm    bool            `json:"confirm"`
}
