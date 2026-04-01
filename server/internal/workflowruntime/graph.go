package workflowruntime

func BuildExecutionPlan(dsl WorkflowDSL) []string {
	nodeIDs := make([]string, 0, len(dsl.Nodes))
	for _, node := range dsl.Nodes {
		nodeIDs = append(nodeIDs, node.ID)
	}

	outgoing := make(map[string][]string, len(dsl.Nodes))
	incomingCount := make(map[string]int, len(dsl.Nodes))
	nodeExists := make(map[string]bool, len(dsl.Nodes))
	for _, node := range dsl.Nodes {
		outgoing[node.ID] = []string{}
		incomingCount[node.ID] = 0
		nodeExists[node.ID] = true
	}

	for _, edge := range dsl.Edges {
		if !nodeExists[edge.Source] || !nodeExists[edge.Target] {
			continue
		}
		outgoing[edge.Source] = append(outgoing[edge.Source], edge.Target)
		incomingCount[edge.Target] = incomingCount[edge.Target] + 1
	}

	queue := make([]string, 0)
	for _, nodeID := range nodeIDs {
		if incomingCount[nodeID] == 0 {
			queue = append(queue, nodeID)
		}
	}

	ordered := make([]string, 0, len(nodeIDs))
	incoming := make(map[string]int, len(incomingCount))
	for k, v := range incomingCount {
		incoming[k] = v
	}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		ordered = append(ordered, current)
		for _, next := range outgoing[current] {
			incoming[next] = incoming[next] - 1
			if incoming[next] == 0 {
				queue = append(queue, next)
			}
		}
	}

	if len(ordered) != len(nodeIDs) {
		seen := make(map[string]bool, len(ordered))
		for _, id := range ordered {
			seen[id] = true
		}
		for _, id := range nodeIDs {
			if !seen[id] {
				ordered = append(ordered, id)
			}
		}
	}

	return ordered
}

