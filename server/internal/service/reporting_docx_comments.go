package service

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"io"
	"sort"
	"strconv"
	"strings"

	"sxfgssever/server/internal/model"
)

type docxParagraphAnchor struct {
	Index      int
	Text       string
	Style      string
	CommentIDs []string
}

func buildTemplateCommentGuidanceJSON(raw []byte) json.RawMessage {
	items := extractTemplateCommentGuidanceFromDOCX(raw)
	normalized, err := json.Marshal(items)
	if err != nil || len(normalized) == 0 {
		return json.RawMessage(`[]`)
	}
	return normalized
}

func extractTemplateCommentGuidanceFromDOCX(raw []byte) []model.TemplateCommentGuidanceItem {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return []model.TemplateCommentGuidanceItem{}
	}
	commentsXML := readZipFile(reader, "word/comments.xml")
	documentXML := readZipFile(reader, "word/document.xml")
	if len(commentsXML) == 0 || len(documentXML) == 0 {
		return []model.TemplateCommentGuidanceItem{}
	}

	commentMap := parseDOCXComments(commentsXML)
	if len(commentMap) == 0 {
		return []model.TemplateCommentGuidanceItem{}
	}
	anchors := parseDOCXCommentAnchors(documentXML)
	anchorByCommentID := map[string]docxParagraphAnchor{}
	for _, anchor := range anchors {
		for _, commentID := range anchor.CommentIDs {
			if _, exists := anchorByCommentID[commentID]; exists {
				continue
			}
			anchorByCommentID[commentID] = anchor
		}
	}

	headings := make([]docxParagraphAnchor, 0)
	for _, anchor := range anchors {
		if level := detectHeadingLevel(anchor.Style, anchor.Text); level > 0 {
			headings = append(headings, anchor)
		}
	}

	commentIDs := make([]string, 0, len(commentMap))
	for commentID := range commentMap {
		commentIDs = append(commentIDs, commentID)
	}
	sort.Slice(commentIDs, func(i, j int) bool {
		left, leftErr := strconv.Atoi(commentIDs[i])
		right, rightErr := strconv.Atoi(commentIDs[j])
		if leftErr == nil && rightErr == nil {
			return left < right
		}
		return commentIDs[i] < commentIDs[j]
	})

	items := make([]model.TemplateCommentGuidanceItem, 0, len(commentIDs))
	for _, commentID := range commentIDs {
		commentText := normalizeCommentText(commentMap[commentID])
		if commentText == "" {
			continue
		}
		anchor, hasAnchor := anchorByCommentID[commentID]
		sectionTitle := ""
		sectionLevel := 0
		if hasAnchor {
			sectionTitle, sectionLevel = findNearestSection(headings, anchor.Index)
		}
		item := model.TemplateCommentGuidanceItem{
			ID:           "comment-" + commentID,
			CommentText:  commentText,
			AnchorText:   "",
			AnchorIndex:  -1,
			SectionTitle: sectionTitle,
			SectionLevel: sectionLevel,
			SourceType:   "template_comment",
		}
		if hasAnchor {
			item.AnchorText = anchor.Text
			item.AnchorIndex = anchor.Index
		}
		items = append(items, item)
	}
	return items
}

func readZipFile(reader *zip.Reader, name string) []byte {
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		handle, err := file.Open()
		if err != nil {
			return nil
		}
		defer handle.Close()
		raw, err := io.ReadAll(handle)
		if err != nil {
			return nil
		}
		return raw
	}
	return nil
}

func parseDOCXComments(raw []byte) map[string]string {
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	commentTexts := map[string]string{}
	currentCommentID := ""
	var builder strings.Builder
	inComment := false
	inText := false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "comment":
				currentCommentID = ""
				for _, attribute := range value.Attr {
					if attribute.Name.Local == "id" {
						currentCommentID = strings.TrimSpace(attribute.Value)
						break
					}
				}
				builder.Reset()
				inComment = currentCommentID != ""
			case "t":
				if inComment {
					inText = true
				}
			}
		case xml.CharData:
			if inComment && inText {
				builder.WriteString(string(value))
			}
		case xml.EndElement:
			switch value.Name.Local {
			case "t":
				inText = false
			case "p":
				if inComment {
					builder.WriteString("\n")
				}
			case "comment":
				if inComment && currentCommentID != "" {
					commentTexts[currentCommentID] = builder.String()
				}
				inComment = false
				inText = false
				currentCommentID = ""
			}
		}
	}
	return commentTexts
}

func parseDOCXCommentAnchors(raw []byte) []docxParagraphAnchor {
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	anchors := make([]docxParagraphAnchor, 0)
	inParagraph := false
	inText := false
	paragraphIndex := -1
	currentStyle := ""
	commentIDs := map[string]struct{}{}
	var paragraphText strings.Builder
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch value := token.(type) {
		case xml.StartElement:
			switch value.Name.Local {
			case "p":
				inParagraph = true
				paragraphIndex++
				currentStyle = ""
				paragraphText.Reset()
				commentIDs = map[string]struct{}{}
			case "pStyle":
				if !inParagraph {
					continue
				}
				for _, attribute := range value.Attr {
					if attribute.Name.Local == "val" {
						currentStyle = strings.TrimSpace(attribute.Value)
						break
					}
				}
			case "commentRangeStart":
				if !inParagraph {
					continue
				}
				for _, attribute := range value.Attr {
					if attribute.Name.Local == "id" {
						commentID := strings.TrimSpace(attribute.Value)
						if commentID != "" {
							commentIDs[commentID] = struct{}{}
						}
						break
					}
				}
			case "t":
				if inParagraph {
					inText = true
				}
			}
		case xml.CharData:
			if inParagraph && inText {
				paragraphText.WriteString(string(value))
			}
		case xml.EndElement:
			switch value.Name.Local {
			case "t":
				inText = false
			case "p":
				if !inParagraph {
					continue
				}
				ids := make([]string, 0, len(commentIDs))
				for commentID := range commentIDs {
					ids = append(ids, commentID)
				}
				sort.Strings(ids)
				anchors = append(anchors, docxParagraphAnchor{
					Index:      paragraphIndex,
					Text:       normalizeCommentText(paragraphText.String()),
					Style:      currentStyle,
					CommentIDs: ids,
				})
				inParagraph = false
				inText = false
			}
		}
	}
	return anchors
}

func findNearestSection(headings []docxParagraphAnchor, paragraphIndex int) (string, int) {
	nearestTitle := ""
	nearestLevel := 0
	for _, heading := range headings {
		if heading.Index > paragraphIndex {
			break
		}
		level := detectHeadingLevel(heading.Style, heading.Text)
		if level <= 0 {
			continue
		}
		if level == 1 {
			continue
		}
		nearestTitle = heading.Text
		nearestLevel = level
	}
	if nearestTitle != "" {
		return nearestTitle, nearestLevel
	}
	for _, heading := range headings {
		level := detectHeadingLevel(heading.Style, heading.Text)
		if level > 0 {
			return heading.Text, level
		}
	}
	return "", 0
}

func detectHeadingLevel(style string, text string) int {
	normalizedStyle := strings.ToLower(strings.TrimSpace(style))
	for _, prefix := range []string{"heading", "标题"} {
		index := strings.Index(normalizedStyle, prefix)
		if index < 0 {
			continue
		}
		digits := extractDigits(normalizedStyle[index+len(prefix):])
		if digits > 0 {
			return digits
		}
	}
	if strings.HasPrefix(strings.TrimSpace(text), "#") {
		level := 0
		for _, ch := range text {
			if ch != '#' {
				break
			}
			level++
		}
		return level
	}
	return 0
}

func extractDigits(raw string) int {
	digitBuilder := strings.Builder{}
	for _, ch := range raw {
		if ch >= '0' && ch <= '9' {
			digitBuilder.WriteRune(ch)
			continue
		}
		if digitBuilder.Len() > 0 {
			break
		}
	}
	if digitBuilder.Len() == 0 {
		return 0
	}
	value, err := strconv.Atoi(digitBuilder.String())
	if err != nil {
		return 0
	}
	return value
}

func normalizeCommentText(raw string) string {
	segments := strings.Fields(strings.ReplaceAll(raw, "\n", " "))
	if len(segments) == 0 {
		return ""
	}
	return strings.TrimSpace(strings.Join(segments, " "))
}
