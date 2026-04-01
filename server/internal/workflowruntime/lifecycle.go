package workflowruntime

func StatusFromLifecycleEvents(events []LifecycleEvent) ExecutionStatus {
	state := "idle"

	for _, event := range events {
		switch state {
		case "idle":
			if event.Type == "BEGIN" {
				state = "running"
			}
		case "running":
			switch event.Type {
			case "WAIT_INPUT":
				state = "waiting_input"
			case "COMPLETE":
				state = "completed"
			case "FAIL":
				state = "failed"
			case "CANCEL":
				state = "cancelled"
			}
		case "waiting_input":
			switch event.Type {
			case "RESUME":
				state = "running"
			case "FAIL":
				state = "failed"
			case "CANCEL":
				state = "cancelled"
			}
		default:
		}
	}

	switch state {
	case "waiting_input":
		return ExecutionStatusWaitingInput
	case "completed":
		return ExecutionStatusCompleted
	case "failed":
		return ExecutionStatusFailed
	case "cancelled":
		return ExecutionStatusCancelled
	default:
		return ExecutionStatusRunning
	}
}

