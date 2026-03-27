package model

type HealthStatus string

const (
	HealthStatusOK HealthStatus = "ok"
)

type HealthDTO struct {
	Status    HealthStatus `json:"status"`
	Service   string       `json:"service"`
	Timestamp string       `json:"timestamp"`
}
