package service

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"strings"
)

func buildMinimalDOCX(title string, markdown string) []byte {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)

	addZipFile(writer, "[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)

	addZipFile(writer, "_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)

	lines := strings.Split(strings.TrimSpace(markdown), "\n")
	if len(lines) == 0 || (len(lines) == 1 && strings.TrimSpace(lines[0]) == "") {
		lines = []string{"## " + strings.TrimSpace(title), "", "请编辑内容。"}
	}
	paragraphs := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			paragraphs = append(paragraphs, `<w:p/>`)
			continue
		}
		text := xmlEscape(trimmed)
		paragraphs = append(paragraphs, `<w:p><w:r><w:rPr><w:rFonts w:ascii="FZFSK" w:hAnsi="FZFSK" w:eastAsia="FZFSK" w:cs="FZFSK"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr><w:t xml:space="preserve">`+text+`</w:t></w:r></w:p>`)
	}
	documentXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
 <w:body>` + strings.Join(paragraphs, "") + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
	addZipFile(writer, "word/document.xml", documentXML)
	_ = writer.Close()
	return buffer.Bytes()
}

func addZipFile(writer *zip.Writer, name string, content string) {
	entry, err := writer.Create(name)
	if err != nil {
		return
	}
	_, _ = entry.Write([]byte(content))
}

func xmlEscape(raw string) string {
	escaped, err := xml.Marshal(struct {
		XMLName xml.Name `xml:"v"`
		Value   string   `xml:",chardata"`
	}{Value: raw})
	if err != nil {
		return raw
	}
	out := string(escaped)
	out = strings.TrimPrefix(out, "<v>")
	out = strings.TrimSuffix(out, "</v>")
	return out
}
