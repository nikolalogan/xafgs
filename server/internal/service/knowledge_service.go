package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
	"unicode"

	"sxfgssever/server/internal/ai"
	"sxfgssever/server/internal/model"
	"sxfgssever/server/internal/repository"
	"sxfgssever/server/internal/response"
)

const (
	knowledgeChunkMaxLen  = 800
	knowledgeChunkMinLen  = 500
	knowledgeChunkOverlap = 80
	knowledgeTableWindow  = 20
)

var errKnowledgeIndexCancelled = errors.New("knowledge index cancelled")

type KnowledgeSearchRequest struct {
	Query     string
	TopK      int
	MinScore  float64
	FileIDs   []int64
	BizKey    string
	SubjectID int64
	ProjectID int64
}

type KnowledgeService interface {
	Enqueue(ctx context.Context, fileID int64, versionNo int) *model.APIError
	Cancel(ctx context.Context, fileID int64, versionNo int) *model.APIError
	Reindex(ctx context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError)
	GetStatus(ctx context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError)
	ListJobs(ctx context.Context, limit int) ([]model.KnowledgeIndexQueueItemDTO, *model.APIError)
	Search(ctx context.Context, userID int64, request KnowledgeSearchRequest) (model.KnowledgeSearchResultDTO, *model.APIError)
	RunOnce(ctx context.Context) bool
	StartWorker(ctx context.Context, interval time.Duration)
}

type knowledgeService struct {
	repository           repository.KnowledgeRepository
	fileRepository       repository.FileRepository
	fileService          FileService
	systemConfigService  SystemConfigService
	documentParseService DocumentParseService
	embeddingClient      ai.EmbeddingClient
	enabled              bool
}

func NewKnowledgeService(
	repository repository.KnowledgeRepository,
	fileRepository repository.FileRepository,
	fileService FileService,
	systemConfigService SystemConfigService,
	documentParseService DocumentParseService,
	embeddingClient ai.EmbeddingClient,
) KnowledgeService {
	return &knowledgeService{
		repository:           repository,
		fileRepository:       fileRepository,
		fileService:          fileService,
		systemConfigService:  systemConfigService,
		documentParseService: documentParseService,
		embeddingClient:      embeddingClient,
		enabled:              repository != nil && embeddingClient != nil,
	}
}

func (service *knowledgeService) Enqueue(_ context.Context, fileID int64, versionNo int) *model.APIError {
	if !service.enabled {
		return model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	if fileID <= 0 || versionNo <= 0 {
		return model.NewAPIError(400, response.CodeBadRequest, "fileId/versionNo 不合法")
	}
	if _, ok := service.repository.EnqueueJob(fileID, versionNo); !ok {
		return model.NewAPIError(500, response.CodeInternal, "索引任务入队失败")
	}
	return nil
}

func (service *knowledgeService) Cancel(_ context.Context, fileID int64, versionNo int) *model.APIError {
	if !service.enabled {
		return model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	if fileID <= 0 || versionNo <= 0 {
		return model.NewAPIError(400, response.CodeBadRequest, "fileId/versionNo 不合法")
	}
	if ok := service.repository.CancelJob(fileID, versionNo); !ok {
		return model.NewAPIError(404, response.CodeNotFound, "索引任务不存在")
	}
	return nil
}

func (service *knowledgeService) Reindex(ctx context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError) {
	if !service.enabled {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	if fileID <= 0 {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId 不合法")
	}
	resolvedVersion, apiError := service.fileService.ResolveReference(ctx, fileID, versionNo)
	if apiError != nil {
		return model.KnowledgeIndexStatusDTO{}, apiError
	}
	if enqueueError := service.Enqueue(ctx, fileID, resolvedVersion.VersionNo); enqueueError != nil {
		return model.KnowledgeIndexStatusDTO{}, enqueueError
	}
	return service.GetStatus(ctx, fileID, resolvedVersion.VersionNo)
}

func (service *knowledgeService) GetStatus(_ context.Context, fileID int64, versionNo int) (model.KnowledgeIndexStatusDTO, *model.APIError) {
	if !service.enabled {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	if fileID <= 0 {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(400, response.CodeBadRequest, "fileId 不合法")
	}
	job, ok := service.repository.FindLatestJob(fileID, versionNo)
	if !ok {
		return model.KnowledgeIndexStatusDTO{}, model.NewAPIError(404, response.CodeNotFound, "索引任务不存在")
	}
	return model.KnowledgeIndexStatusDTO{
		FileID:       job.FileID,
		VersionNo:    job.VersionNo,
		Status:       job.Status,
		RetryCount:   job.RetryCount,
		ErrorMessage: job.ErrorMessage,
		StartedAt:    job.StartedAt,
		FinishedAt:   job.FinishedAt,
		UpdatedAt:    job.UpdatedAt,
	}, nil
}

func (service *knowledgeService) ListJobs(ctx context.Context, limit int) ([]model.KnowledgeIndexQueueItemDTO, *model.APIError) {
	if !service.enabled {
		return nil, model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	jobs := service.repository.ListJobs(limit)
	items := make([]model.KnowledgeIndexQueueItemDTO, 0, len(jobs))
	for _, job := range jobs {
		fileName := "-"
		version, apiError := service.fileService.ResolveReference(ctx, job.FileID, job.VersionNo)
		if apiError == nil {
			fileName = strings.TrimSpace(version.OriginName)
		}
		items = append(items, model.KnowledgeIndexQueueItemDTO{
			JobID:        job.ID,
			FileID:       job.FileID,
			VersionNo:    job.VersionNo,
			FileName:     fileName,
			Status:       strings.TrimSpace(job.Status),
			RetryCount:   job.RetryCount,
			ErrorMessage: strings.TrimSpace(job.ErrorMessage),
			UpdatedAt:    job.UpdatedAt,
			StartedAt:    job.StartedAt,
			FinishedAt:   job.FinishedAt,
		})
	}
	return items, nil
}

func (service *knowledgeService) Search(ctx context.Context, _ int64, request KnowledgeSearchRequest) (model.KnowledgeSearchResultDTO, *model.APIError) {
	if !service.enabled {
		return model.KnowledgeSearchResultDTO{}, model.NewAPIError(503, response.CodeInternal, "知识检索能力未启用")
	}
	query := strings.TrimSpace(request.Query)
	if query == "" {
		return model.KnowledgeSearchResultDTO{}, model.NewAPIError(400, response.CodeBadRequest, "query 不能为空")
	}
	embeddingConfig, apiError := service.getEmbeddingConfig(ctx)
	if apiError != nil {
		return model.KnowledgeSearchResultDTO{}, apiError
	}
	vector, embeddingError := service.embedSingle(ctx, embeddingConfig, query)
	if embeddingError != nil {
		return model.KnowledgeSearchResultDTO{}, model.NewAPIError(502, response.CodeInternal, "向量化失败："+embeddingError.Error())
	}
	hits := service.repository.Search(embeddingConfig.Model, vector, repository.KnowledgeSearchFilter{
		FileIDs:        request.FileIDs,
		BizKey:         strings.TrimSpace(request.BizKey),
		BizKeyPrefixes: buildScopeBizKeyPrefixes(request.SubjectID, request.ProjectID),
		TopK:           request.TopK,
		MinScore:       request.MinScore,
	})
	return model.KnowledgeSearchResultDTO{Hits: hits}, nil
}

func (service *knowledgeService) RunOnce(ctx context.Context) bool {
	if !service.enabled {
		return false
	}
	job, ok := service.repository.ClaimNextJob(3)
	if !ok {
		return false
	}
	if err := service.runJob(ctx, job); err != nil {
		if errors.Is(err, errKnowledgeIndexCancelled) {
			return true
		}
		_ = service.repository.MarkJobFailed(job.ID, err.Error())
		log.Printf("knowledge-index failed fileId=%d versionNo=%d err=%v", job.FileID, job.VersionNo, err)
		return true
	}
	_ = service.repository.MarkJobSucceeded(job.ID)
	return true
}

func (service *knowledgeService) StartWorker(ctx context.Context, interval time.Duration) {
	if !service.enabled {
		return
	}
	if interval <= 0 {
		interval = 3 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				for service.RunOnce(ctx) {
				}
			}
		}
	}()
}

func (service *knowledgeService) runJob(ctx context.Context, job model.KnowledgeIndexJob) error {
	if service.isCancelled(job.FileID, job.VersionNo) {
		return errKnowledgeIndexCancelled
	}
	fileEntity, ok := service.fileRepository.FindFileByID(job.FileID)
	if !ok {
		return fmt.Errorf("file 不存在")
	}
	if fileEntity.CreatedBy <= 0 {
		return fmt.Errorf("file 创建人不存在")
	}
	embeddingConfig, apiError := service.getEmbeddingConfig(ctx)
	if apiError != nil {
		return fmt.Errorf("%s", apiError.Message)
	}
	parsed, parseError := service.documentParseService.ParseCaseFile(ctx, model.ReportCaseFile{
		FileID:    job.FileID,
		VersionNo: job.VersionNo,
	})
	if parseError != nil {
		return fmt.Errorf("文档解析失败: %s", parseError.Message)
	}
	if service.isCancelled(job.FileID, job.VersionNo) {
		return errKnowledgeIndexCancelled
	}
	chunks := buildKnowledgeChunks(parsed, fileEntity.BizKey)
	if len(chunks) == 0 {
		return fmt.Errorf("未提取到有效文本分块")
	}
	if service.isCancelled(job.FileID, job.VersionNo) {
		return errKnowledgeIndexCancelled
	}
	inputs := make([]string, 0, len(chunks))
	for _, chunk := range chunks {
		inputs = append(inputs, chunk.ChunkText)
	}
	embeddings, embedError := service.embeddingClient.CreateEmbeddings(ctx, ai.EmbeddingRequest{
		BaseURL: embeddingConfig.BaseURL,
		APIKey:  embeddingConfig.APIKey,
		Model:   embeddingConfig.Model,
		Input:   inputs,
		Timeout: 90 * time.Second,
	})
	if embedError != nil {
		return fmt.Errorf("向量化失败: %w", embedError)
	}
	if service.isCancelled(job.FileID, job.VersionNo) {
		return errKnowledgeIndexCancelled
	}
	if len(embeddings) != len(chunks) {
		return fmt.Errorf("embedding 数量不匹配")
	}
	for index := range chunks {
		if len(embeddings[index]) != embeddingConfig.Dimension {
			return fmt.Errorf("embedding 维度非法: %d", len(embeddings[index]))
		}
		chunks[index].Embedding = embeddings[index]
	}
	if service.isCancelled(job.FileID, job.VersionNo) {
		return errKnowledgeIndexCancelled
	}
	if ok := service.repository.ReplaceChunks(job.FileID, job.VersionNo, embeddingConfig.Model, chunks); !ok {
		return fmt.Errorf("落库失败")
	}
	return nil
}

func (service *knowledgeService) isCancelled(fileID int64, versionNo int) bool {
	if fileID <= 0 || versionNo <= 0 {
		return false
	}
	job, ok := service.repository.FindLatestJob(fileID, versionNo)
	if !ok {
		return false
	}
	return job.Status == model.KnowledgeIndexJobStatusCancelled
}

func (service *knowledgeService) embedSingle(ctx context.Context, config embeddingRuntimeConfig, input string) ([]float64, error) {
	results, err := service.embeddingClient.CreateEmbeddings(ctx, ai.EmbeddingRequest{
		BaseURL: config.BaseURL,
		APIKey:  config.APIKey,
		Model:   config.Model,
		Input:   []string{input},
		Timeout: 45 * time.Second,
	})
	if err != nil {
		return nil, err
	}
	if len(results) != 1 || len(results[0]) != config.Dimension {
		return nil, fmt.Errorf("embedding 返回非法")
	}
	return results[0], nil
}

type embeddingRuntimeConfig struct {
	BaseURL   string
	APIKey    string
	Model     string
	Dimension int
}

func (service *knowledgeService) getEmbeddingConfig(ctx context.Context) (embeddingRuntimeConfig, *model.APIError) {
	config, apiError := service.systemConfigService.Get(ctx)
	if apiError != nil {
		return embeddingRuntimeConfig{}, apiError
	}
	baseURL := strings.TrimSpace(config.LocalEmbeddingBaseURL)
	apiKey := strings.TrimSpace(config.LocalEmbeddingAPIKey)
	modelName := strings.TrimSpace(config.LocalEmbeddingModel)
	dimension := config.LocalEmbeddingDimension
	if baseURL == "" || apiKey == "" || modelName == "" || dimension <= 0 {
		return embeddingRuntimeConfig{}, model.NewAPIError(400, response.CodeBadRequest, "本地向量配置缺失，请联系管理员在系统设置中补充")
	}
	return embeddingRuntimeConfig{
		BaseURL:   baseURL,
		APIKey:    apiKey,
		Model:     modelName,
		Dimension: dimension,
	}, nil
}

type knowledgeMergedSource struct {
	Text      string
	Anchors   []model.KnowledgeChunkAnchor
	SourceRef string
}

type knowledgeChunkPart struct {
	Text      string
	Anchors   []model.KnowledgeChunkAnchor
	SourceRef string
}

func buildKnowledgeChunks(parsed ParsedDocument, bizKey string) []model.KnowledgeChunk {
	sections := make([]model.KnowledgeChunk, 0)
	seen := map[string]bool{}

	mergedSources := mergeKnowledgeSlices(
		parsed.Version.FileID,
		filterKnowledgeLeafSlices(parsed.Slices, parsed.Version.OriginName),
	)
	for _, source := range mergedSources {
		for _, part := range splitMergedSourceWithOverlap(source, knowledgeChunkMaxLen, knowledgeChunkOverlap) {
			partText := strings.TrimSpace(part.Text)
			if partText == "" {
				continue
			}
			contentHash := hashContent(partText)
			if seen[contentHash] {
				continue
			}
			seen[contentHash] = true
			pageStart, pageEnd := resolveAnchorPages(part.Anchors)
			bbox := resolveAnchorBBox(part.Anchors)
			sections = append(sections, model.KnowledgeChunk{
				FileID:        parsed.Version.FileID,
				VersionNo:     parsed.Version.VersionNo,
				BizKey:        strings.TrimSpace(bizKey),
				ChunkIndex:    len(sections),
				ChunkText:     partText,
				ChunkSummary:  summarizeChunk(partText, 80),
				SourceType:    resolveAnchorSourceType(part.Anchors),
				PageStart:     pageStart,
				PageEnd:       pageEnd,
				SourceRef:     part.SourceRef,
				BBoxJSON:      bbox,
				AnchorJSON:    marshalKnowledgeAnchors(part.Anchors),
				Anchors:       part.Anchors,
				ParseStrategy: parsed.Profile.ParseStrategy,
				ContentHash:   contentHash,
			})
		}
	}

	tableChunks := buildTableChunks(parsed, strings.TrimSpace(bizKey), len(sections))
	for _, chunk := range tableChunks {
		if seen[chunk.ContentHash] {
			continue
		}
		seen[chunk.ContentHash] = true
		chunk.ChunkIndex = len(sections)
		chunk.SourceRef = buildSourceRef(parsed.Version.FileID, chunk.PageStart, chunk.PageEnd, chunk.ChunkIndex)
		sections = append(sections, chunk)
	}
	return sections
}

func filterKnowledgeLeafSlices(slices []model.DocumentSlice, originName string) []model.DocumentSlice {
	out := make([]model.DocumentSlice, 0, len(slices))
	normalizedOrigin := strings.TrimSpace(originName)
	for _, slice := range slices {
		text := strings.TrimSpace(slice.CleanText)
		if text == "" {
			continue
		}
		if slice.SliceType != model.DocumentStructureParagraph && slice.SliceType != model.DocumentStructureSection {
			continue
		}
		if slice.SliceType == model.DocumentStructureSection &&
			slice.TitleLevel <= 1 &&
			strings.TrimSpace(slice.Title) != "" &&
			normalizedOrigin != "" &&
			strings.EqualFold(strings.TrimSpace(slice.Title), normalizedOrigin) {
			continue
		}
		out = append(out, slice)
	}
	return out
}

func mergeKnowledgeSlices(fileID int64, slices []model.DocumentSlice) []knowledgeMergedSource {
	if len(slices) == 0 {
		return nil
	}
	out := make([]knowledgeMergedSource, 0, len(slices))
	for start := 0; start < len(slices); {
		end := start + 1
		currentLen := len([]rune(strings.TrimSpace(slices[start].CleanText)))
		for end < len(slices) && currentLen < knowledgeChunkMinLen {
			previous := slices[end-1]
			next := slices[end]
			if !canMergeKnowledgeSlice(previous, next) {
				break
			}
			currentLen += 2 + len([]rune(strings.TrimSpace(next.CleanText)))
			end++
		}
		out = append(out, buildMergedKnowledgeSource(fileID, slices[start:end], start))
		start = end
	}
	return out
}

func canMergeKnowledgeSlice(previous model.DocumentSlice, next model.DocumentSlice) bool {
	if strings.TrimSpace(previous.SourceType) != strings.TrimSpace(next.SourceType) {
		return false
	}
	if next.PageStart > 0 && previous.PageEnd > 0 && next.PageStart > previous.PageEnd+1 {
		return false
	}
	if next.SliceType == model.DocumentStructureSection && next.TitleLevel > 0 {
		return false
	}
	return true
}

func buildMergedKnowledgeSource(fileID int64, slices []model.DocumentSlice, startOrder int) knowledgeMergedSource {
	if len(slices) == 0 {
		return knowledgeMergedSource{}
	}
	anchors := make([]model.KnowledgeChunkAnchor, 0, len(slices))
	parts := make([]string, 0, len(slices))
	cursor := 0
	for index, slice := range slices {
		text := strings.TrimSpace(slice.CleanText)
		if text == "" {
			continue
		}
		if len(parts) > 0 {
			cursor += 2
		}
		partStart := cursor
		partLen := len([]rune(text))
		partEnd := partStart + partLen
		parts = append(parts, text)
		anchors = append(anchors, model.KnowledgeChunkAnchor{
			SourceType: strings.TrimSpace(slice.SourceType),
			SliceType:  strings.TrimSpace(slice.SliceType),
			PageStart:  max(1, slice.PageStart),
			PageEnd:    max(max(1, slice.PageStart), slice.PageEnd),
			SourceRef:  buildSliceAnchorRef(fileID, slice, startOrder+index),
			BBox:       normalizeRawJSON(slice.BBoxJSON),
			OOXMLPath:  buildOOXMLPathHint(slice),
			CharStart:  partStart,
			CharEnd:    partEnd,
		})
		cursor = partEnd
	}
	mergedText := strings.Join(parts, "\n\n")
	if len(anchors) == 0 || strings.TrimSpace(mergedText) == "" {
		return knowledgeMergedSource{}
	}
	return knowledgeMergedSource{
		Text:      mergedText,
		Anchors:   anchors,
		SourceRef: anchors[0].SourceRef,
	}
}

func buildSliceAnchorRef(fileID int64, slice model.DocumentSlice, order int) string {
	pageStart := max(1, slice.PageStart)
	pageEnd := max(pageStart, slice.PageEnd)
	return fmt.Sprintf("f%d#p%d-%d#s%d", fileID, pageStart, pageEnd, order)
}

func buildOOXMLPathHint(slice model.DocumentSlice) string {
	if strings.TrimSpace(slice.SourceType) != model.DocumentSourceTypeNativeText {
		return ""
	}
	var bbox map[string]any
	if err := json.Unmarshal(slice.BBoxJSON, &bbox); err != nil {
		return ""
	}
	block, ok := bbox["block"]
	if !ok {
		return ""
	}
	switch value := block.(type) {
	case float64:
		return fmt.Sprintf("word/document.xml#block:%d", int(value))
	case int:
		return fmt.Sprintf("word/document.xml#block:%d", value)
	default:
		return ""
	}
}

func splitMergedSourceWithOverlap(source knowledgeMergedSource, maxLen int, overlap int) []knowledgeChunkPart {
	text := strings.TrimSpace(source.Text)
	if text == "" {
		return nil
	}
	runes := []rune(text)
	if len(runes) <= knowledgeChunkMinLen {
		anchors := projectAnchors(source.Anchors, 0, len(runes))
		return []knowledgeChunkPart{{
			Text:      text,
			Anchors:   anchors,
			SourceRef: source.SourceRef,
		}}
	}
	if maxLen <= 0 {
		maxLen = knowledgeChunkMaxLen
	}
	if overlap < 0 {
		overlap = 0
	}
	out := make([]knowledgeChunkPart, 0)
	start := 0
	for start < len(runes) {
		end := start + maxLen
		if end > len(runes) {
			end = len(runes)
		}
		trimmedStart, trimmedEnd := trimChunkWindow(runes, start, end)
		if trimmedStart < trimmedEnd {
			chunkText := string(runes[trimmedStart:trimmedEnd])
			anchors := projectAnchors(source.Anchors, trimmedStart, trimmedEnd)
			chunkSourceRef := source.SourceRef
			if len(anchors) > 0 && strings.TrimSpace(anchors[0].SourceRef) != "" {
				chunkSourceRef = strings.TrimSpace(anchors[0].SourceRef)
			}
			out = append(out, knowledgeChunkPart{
				Text:      chunkText,
				Anchors:   anchors,
				SourceRef: chunkSourceRef,
			})
		}
		if end == len(runes) {
			break
		}
		nextStart := end - overlap
		if nextStart <= start {
			nextStart = end
		}
		start = nextStart
	}
	return out
}

func trimChunkWindow(runes []rune, start int, end int) (int, int) {
	trimmedStart := start
	trimmedEnd := end
	for trimmedStart < trimmedEnd && unicode.IsSpace(runes[trimmedStart]) {
		trimmedStart++
	}
	for trimmedEnd > trimmedStart && unicode.IsSpace(runes[trimmedEnd-1]) {
		trimmedEnd--
	}
	return trimmedStart, trimmedEnd
}

func projectAnchors(anchors []model.KnowledgeChunkAnchor, start int, end int) []model.KnowledgeChunkAnchor {
	if len(anchors) == 0 || start >= end {
		return nil
	}
	out := make([]model.KnowledgeChunkAnchor, 0, len(anchors))
	for _, anchor := range anchors {
		left := max(start, anchor.CharStart)
		right := min(end, anchor.CharEnd)
		if left >= right {
			continue
		}
		copied := anchor
		copied.CharStart = left - start
		copied.CharEnd = right - start
		out = append(out, copied)
	}
	return out
}

func resolveAnchorPages(anchors []model.KnowledgeChunkAnchor) (int, int) {
	if len(anchors) == 0 {
		return 1, 1
	}
	pageStart := 0
	pageEnd := 0
	for _, anchor := range anchors {
		start := max(1, anchor.PageStart)
		end := max(start, anchor.PageEnd)
		if pageStart == 0 || start < pageStart {
			pageStart = start
		}
		if end > pageEnd {
			pageEnd = end
		}
	}
	if pageStart <= 0 {
		pageStart = 1
	}
	if pageEnd < pageStart {
		pageEnd = pageStart
	}
	return pageStart, pageEnd
}

func resolveAnchorBBox(anchors []model.KnowledgeChunkAnchor) []byte {
	for _, anchor := range anchors {
		if strings.TrimSpace(string(anchor.BBox)) != "" && strings.TrimSpace(string(anchor.BBox)) != "null" {
			return []byte(anchor.BBox)
		}
	}
	return []byte("null")
}

func resolveAnchorSourceType(anchors []model.KnowledgeChunkAnchor) string {
	for _, anchor := range anchors {
		if strings.TrimSpace(anchor.SourceType) != "" {
			return strings.TrimSpace(anchor.SourceType)
		}
	}
	return ""
}

func normalizeRawJSON(raw []byte) json.RawMessage {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return json.RawMessage(`null`)
	}
	var value any
	if err := json.Unmarshal([]byte(trimmed), &value); err != nil {
		return json.RawMessage(`null`)
	}
	return json.RawMessage(trimmed)
}

func marshalKnowledgeAnchors(anchors []model.KnowledgeChunkAnchor) []byte {
	if len(anchors) == 0 {
		return []byte("[]")
	}
	payload, err := json.Marshal(anchors)
	if err != nil {
		return []byte("[]")
	}
	return payload
}

func buildTableChunks(parsed ParsedDocument, bizKey string, startIndex int) []model.KnowledgeChunk {
	if len(parsed.Tables) == 0 || len(parsed.TableCells) == 0 {
		return nil
	}
	cellMap := map[int64][]model.DocumentTableCell{}
	for _, cell := range parsed.TableCells {
		cellMap[cell.TableID] = append(cellMap[cell.TableID], cell)
	}
	out := make([]model.KnowledgeChunk, 0)
	chunkIndex := startIndex
	for _, table := range parsed.Tables {
		cells := cellMap[table.ID]
		if len(cells) == 0 {
			continue
		}
		sort.Slice(cells, func(i, j int) bool {
			if cells[i].RowIndex != cells[j].RowIndex {
				return cells[i].RowIndex < cells[j].RowIndex
			}
			return cells[i].ColIndex < cells[j].ColIndex
		})
		rows := map[int][]string{}
		rowOrder := make([]int, 0)
		for _, cell := range cells {
			value := strings.TrimSpace(cell.NormalizedValue)
			if value == "" {
				value = strings.TrimSpace(cell.RawText)
			}
			if _, exists := rows[cell.RowIndex]; !exists {
				rowOrder = append(rowOrder, cell.RowIndex)
			}
			rows[cell.RowIndex] = append(rows[cell.RowIndex], value)
		}
		sort.Ints(rowOrder)
		window := make([]string, 0, knowledgeTableWindow)
		for index, rowIndex := range rowOrder {
			rowText := strings.Join(rows[rowIndex], " | ")
			window = append(window, fmt.Sprintf("R%d: %s", rowIndex+1, strings.TrimSpace(rowText)))
			if len(window) >= knowledgeTableWindow || index == len(rowOrder)-1 {
				content := strings.TrimSpace(fmt.Sprintf("表格：%s\n%s", strings.TrimSpace(table.Title), strings.Join(window, "\n")))
				if content != "" {
					anchors := []model.KnowledgeChunkAnchor{{
						SourceType: strings.TrimSpace(table.SourceType),
						SliceType:  model.DocumentStructureTable,
						PageStart:  max(1, table.PageStart),
						PageEnd:    max(max(1, table.PageStart), table.PageEnd),
						SourceRef:  buildSourceRef(parsed.Version.FileID, table.PageStart, table.PageEnd, chunkIndex),
						BBox:       normalizeRawJSON(table.BBoxJSON),
						CharStart:  0,
						CharEnd:    len([]rune(content)),
					}}
					out = append(out, model.KnowledgeChunk{
						FileID:        parsed.Version.FileID,
						VersionNo:     parsed.Version.VersionNo,
						BizKey:        bizKey,
						ChunkIndex:    chunkIndex,
						ChunkText:     content,
						ChunkSummary:  summarizeChunk(content, 80),
						SourceType:    table.SourceType,
						PageStart:     table.PageStart,
						PageEnd:       table.PageEnd,
						SourceRef:     buildSourceRef(parsed.Version.FileID, table.PageStart, table.PageEnd, chunkIndex),
						BBoxJSON:      table.BBoxJSON,
						AnchorJSON:    marshalKnowledgeAnchors(anchors),
						Anchors:       anchors,
						ParseStrategy: parsed.Profile.ParseStrategy,
						ContentHash:   hashContent(content),
					})
					chunkIndex++
				}
				window = make([]string, 0, knowledgeTableWindow)
			}
		}
	}
	return out
}

func summarizeChunk(text string, maxLen int) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	parts := strings.Fields(trimmed)
	compact := strings.Join(parts, " ")
	runes := []rune(compact)
	if len(runes) <= maxLen {
		return compact
	}
	return string(runes[:maxLen]) + "…"
}

func buildSourceRef(fileID int64, pageStart int, pageEnd int, chunkIndex int) string {
	if pageStart <= 0 {
		pageStart = 1
	}
	if pageEnd < pageStart {
		pageEnd = pageStart
	}
	return fmt.Sprintf("f%d#p%d-%d#k%d", fileID, pageStart, pageEnd, chunkIndex)
}

func hashContent(content string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(content)))
	return hex.EncodeToString(sum[:])
}

func buildScopeBizKeyPrefixes(subjectID int64, projectID int64) []string {
	prefixes := make([]string, 0, 2)
	if subjectID > 0 {
		prefixes = append(prefixes, fmt.Sprintf("subject:%d", subjectID))
	}
	if projectID > 0 {
		prefixes = append(prefixes, fmt.Sprintf("project:%d", projectID))
	}
	return prefixes
}
