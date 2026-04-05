package model

type ConflictDifference struct {
	FieldPath     string `json:"fieldPath"`
	ExistingValue any    `json:"existingValue,omitempty"`
	IncomingValue any    `json:"incomingValue,omitempty"`
	Reason        string `json:"reason"`
}

type ConflictResponse struct {
	Conflict    bool                 `json:"conflict"`
	EntityType  string               `json:"entityType"`
	Identity    string               `json:"identity"`
	Differences []ConflictDifference `json:"differences"`
}
