package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

const schemaSQL = `
CREATE TABLE IF NOT EXISTS app_user (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  password VARCHAR(256) NOT NULL,
  role VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS template (
  id BIGSERIAL PRIMARY KEY,
  template_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  engine VARCHAR(32) NOT NULL DEFAULT 'jinja2' CHECK (engine IN ('jinja2')),
  output_type VARCHAR(16) NOT NULL DEFAULT 'html' CHECK (output_type IN ('text', 'html')),
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  content TEXT NOT NULL,
  default_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  CHECK (jsonb_typeof(default_context_json) = 'object')
);

CREATE TABLE IF NOT EXISTS workflow (
  id BIGSERIAL PRIMARY KEY,
  workflow_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  current_draft_version_no INT NOT NULL DEFAULT 1,
  current_published_version_no INT NOT NULL DEFAULT 0,
  dsl_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  CHECK (jsonb_typeof(dsl_json) = 'object'),
  CHECK (jsonb_typeof(dsl_json->'nodes') = 'array'),
  CHECK (jsonb_array_length(dsl_json->'nodes') > 0)
);

CREATE TABLE IF NOT EXISTS workflow_version (
  id BIGSERIAL PRIMARY KEY,
  workflow_id BIGINT NOT NULL REFERENCES workflow(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  dsl_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version_no),
  CHECK (jsonb_typeof(dsl_json) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_workflow_status ON workflow(status);
CREATE INDEX IF NOT EXISTS idx_workflow_version_workflow_version ON workflow_version(workflow_id, version_no);
CREATE INDEX IF NOT EXISTS idx_template_status ON template(status);
`

func Migrate(ctx context.Context, conn *sql.DB) error {
	if _, err := conn.ExecContext(ctx, schemaSQL); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}
	if _, err := conn.ExecContext(ctx, `
ALTER TABLE workflow
ADD COLUMN IF NOT EXISTS menu_key VARCHAR(32) NOT NULL DEFAULT 'reserve' CHECK (menu_key IN ('', 'reserve', 'review', 'postloan'));
ALTER TABLE workflow ALTER COLUMN menu_key SET DEFAULT 'reserve';
UPDATE workflow SET menu_key = 'reserve' WHERE menu_key = '' OR menu_key IS NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_menu_key ON workflow(menu_key);
`); err != nil {
		return fmt.Errorf("migrate workflow menu_key: %w", err)
	}
	return nil
}

func Seed(ctx context.Context, conn *sql.DB) error {
	now := time.Now().UTC()

	// users (developer/admin + normal)
	_, err := conn.ExecContext(ctx, `
INSERT INTO app_user (username, name, password, role, created_at, updated_at, created_by, updated_by)
VALUES
  ('developer', '默认管理员', '123456', 'admin', $1, $1, 1, 1),
  ('normal-user', '普通用户', '123456', 'user', $1, $1, 1, 1)
ON CONFLICT (username) DO NOTHING
`, now)
	if err != nil {
		return fmt.Errorf("seed users: %w", err)
	}

	// demo template
	_, err = conn.ExecContext(ctx, `
INSERT INTO template (template_key, name, description, engine, output_type, status, content, default_context_json, created_at, updated_at, created_by, updated_by)
VALUES (
  'demo_template',
  '示例模板',
  '用于演示 Jinja2 模板渲染与预览（现代化页面）',
  'jinja2',
  'html',
  'active',
  $$<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{ title }}</title>
    <style>
      :root {
        --bg0: #0b1220;
        --bg1: #0f172a;
        --card: rgba(255,255,255,0.06);
        --card2: rgba(255,255,255,0.09);
        --border: rgba(255,255,255,0.12);
        --text: rgba(255,255,255,0.92);
        --muted: rgba(255,255,255,0.68);
        --muted2: rgba(255,255,255,0.52);
        --ok: #22c55e;
        --warn: #f59e0b;
        --bad: #ef4444;
        --accent: #60a5fa;
        --accent2: #a78bfa;
        --shadow: 0 20px 60px rgba(0,0,0,0.35);
        --radius: 18px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        color: var(--text);
        background:
          radial-gradient(1200px 600px at 20% 10%, rgba(96,165,250,0.28), transparent 55%),
          radial-gradient(900px 500px at 80% 20%, rgba(167,139,250,0.22), transparent 55%),
          linear-gradient(180deg, var(--bg0), var(--bg1));
        min-height: 100vh;
      }
      a { color: inherit; text-decoration: none; }
      .wrap { max-width: 1040px; margin: 0 auto; padding: 28px 16px 40px; }
      .topbar {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 16px 18px;
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        box-shadow: var(--shadow); backdrop-filter: blur(10px);
      }
      .brand {
        display: flex; align-items: center; gap: 12px; min-width: 0;
      }
      .logo {
        width: 42px; height: 42px; border-radius: 14px;
        background: linear-gradient(135deg, rgba(96,165,250,0.9), rgba(167,139,250,0.9));
        box-shadow: 0 10px 25px rgba(96,165,250,0.18);
        flex: none;
      }
      .brand h1 { margin: 0; font-size: 14px; letter-spacing: 0.2px; }
      .brand p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
      .pill {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 10px; border-radius: 999px;
        background: rgba(255,255,255,0.05); border: 1px solid var(--border);
        color: var(--muted); font-size: 12px;
      }
      .grid { display: grid; gap: 14px; margin-top: 14px; }
      .kpis { grid-template-columns: repeat(12, 1fr); }
      .card {
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        box-shadow: var(--shadow); padding: 16px; backdrop-filter: blur(10px);
      }
      .kpi { grid-column: span 3; }
      .kpi .label { color: var(--muted); font-size: 12px; }
      .kpi .value { font-size: 22px; margin-top: 8px; font-weight: 700; letter-spacing: 0.2px; }
      .kpi .meta { margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .delta {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 10px; border-radius: 999px; font-size: 12px; border: 1px solid var(--border);
        background: rgba(255,255,255,0.06);
      }
      .delta.up { color: rgba(34,197,94,0.95); }
      .delta.down { color: rgba(239,68,68,0.95); }
      .main { grid-template-columns: repeat(12, 1fr); }
      .left { grid-column: span 7; }
      .right { grid-column: span 5; }
      .section-title { font-size: 13px; color: var(--muted); margin: 0 0 10px; letter-spacing: 0.2px; }
      .table {
        width: 100%; border-collapse: separate; border-spacing: 0;
        overflow: hidden; border-radius: 14px; border: 1px solid var(--border);
        background: rgba(255,255,255,0.04);
      }
      .table th, .table td {
        text-align: left; padding: 10px 12px; font-size: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
      }
      .table th { color: var(--muted); font-weight: 600; background: rgba(255,255,255,0.04); }
      .table tr:last-child td { border-bottom: none; }
      .status {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 6px 10px; border-radius: 999px; font-size: 12px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.06);
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted2); }
      .status.ok .dot { background: var(--ok); }
      .status.warning .dot { background: var(--warn); }
      .status.blocked .dot { background: var(--bad); }
      .progress {
        height: 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10);
        background: rgba(255,255,255,0.05); overflow: hidden;
      }
      .bar {
        height: 100%;
        background: linear-gradient(90deg, rgba(96,165,250,0.95), rgba(167,139,250,0.95));
        width: 0%;
      }
      .list { display: grid; gap: 10px; }
      .item {
        padding: 12px; border-radius: 14px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.10);
      }
      .item h3 { margin: 0; font-size: 13px; }
      .item p { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        padding: 10px 12px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.06);
        color: var(--text); font-size: 12px;
      }
      .btn.primary {
        background: linear-gradient(135deg, rgba(96,165,250,0.95), rgba(167,139,250,0.95));
        border-color: rgba(255,255,255,0.18);
      }
      .footer { margin-top: 14px; color: var(--muted2); font-size: 12px; text-align: center; }
      @media (max-width: 980px) {
        .kpi { grid-column: span 6; }
        .left, .right { grid-column: span 12; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="topbar">
        <div class="brand">
          <div class="logo" aria-hidden="true"></div>
          <div style="min-width:0">
            <h1>{{ brand }}</h1>
            <p>{{ subtitle }} · {{ period.start }} - {{ period.end }}</p>
          </div>
        </div>
        <div class="pill">
          <span>👤 {{ user.name }}</span>
          <span style="opacity:0.7">|</span>
          <span>{{ user.roleLabel }}</span>
        </div>
      </div>

      <div class="grid kpis">
        {% for kpi in kpis %}
          <div class="card kpi">
            <div class="label">{{ kpi.label }}</div>
            <div class="value">{{ kpi.value }}</div>
            <div class="meta">
              {% if kpi.trend == "up" %}
                <div class="delta up">▲ {{ kpi.delta }}</div>
              {% else %}
                <div class="delta down">▼ {{ kpi.delta }}</div>
              {% endif %}
              <div style="color:var(--muted2); font-size:12px">{{ kpi.note }}</div>
            </div>
          </div>
        {% endfor %}
      </div>

      <div class="grid main">
        <div class="card left">
          <p class="section-title">最近任务</p>
          <table class="table">
            <thead>
              <tr>
                <th style="width:34%">任务</th>
                <th style="width:18%">负责人</th>
                <th style="width:18%">状态</th>
                <th style="width:18%">截止</th>
                <th style="width:12%">进度</th>
              </tr>
            </thead>
            <tbody>
              {% for it in items %}
                <tr>
                  <td>
                    <div style="font-weight:600; color:rgba(255,255,255,0.92)">{{ it.name }}</div>
                    <div style="color:var(--muted2); font-size:12px; margin-top:4px">{{ it.summary }}</div>
                  </td>
                  <td style="color:var(--muted)">{{ it.owner }}</td>
                  <td>
                    {% if it.status == "ok" %}
                      <span class="status ok"><span class="dot"></span>正常</span>
                    {% elif it.status == "warning" %}
                      <span class="status warning"><span class="dot"></span>注意</span>
                    {% else %}
                      <span class="status blocked"><span class="dot"></span>阻塞</span>
                    {% endif %}
                  </td>
                  <td style="color:var(--muted)">{{ it.dueDate }}</td>
                  <td>
                    <div class="progress" title="{{ it.progress }}%">
                      <div class="bar" style="width: {{ it.progress }}%"></div>
                    </div>
                  </td>
                </tr>
              {% endfor %}
            </tbody>
          </table>

          <div class="actions">
            {% for link in links %}
              <a class="btn {% if link.primary %}primary{% endif %}" href="{{ link.url }}" target="_blank" rel="noreferrer">
                {{ link.label }}
              </a>
            {% endfor %}
          </div>
        </div>

        <div class="card right">
          <p class="section-title">重点摘要</p>
          <div class="list">
            {% for h in highlights %}
              <div class="item">
                <h3>{{ h.title }}</h3>
                <p>{{ h.desc }}</p>
              </div>
            {% endfor %}
          </div>

          {% if note %}
            <div class="item" style="margin-top: 12px; background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.20)">
              <h3>提示</h3>
              <p>{{ note }}</p>
            </div>
          {% endif %}
        </div>
      </div>

      <div class="footer">{{ footerNote }}</div>
    </div>
  </body>
</html>$$,
  $${
  "title": "周报概览",
  "brand": "SXFG 运营中心",
  "subtitle": "现代化模板示例（gonja / Jinja2 语法）",
  "period": { "start": "2026-03-24", "end": "2026-03-30" },
  "user": { "name": "默认管理员", "roleLabel": "管理员" },
  "kpis": [
    { "label": "活跃工作流", "value": "18", "delta": "+12%", "trend": "up", "note": "较上周" },
    { "label": "成功执行", "value": "3,482", "delta": "+6%", "trend": "up", "note": "较上周" },
    { "label": "失败率", "value": "0.42%", "delta": "-0.08%", "trend": "down", "note": "较上周" },
    { "label": "平均耗时", "value": "187ms", "delta": "-14ms", "trend": "down", "note": "较上周" }
  ],
  "items": [
    { "name": "工作流发布窗口", "summary": "统一发布策略与回滚流程", "owner": "平台组", "status": "ok", "dueDate": "2026-04-02", "progress": 72 },
    { "name": "通知模版迁移", "summary": "迁移历史模版并补齐预览上下文", "owner": "业务组", "status": "warning", "dueDate": "2026-04-05", "progress": 45 },
    { "name": "运行时告警治理", "summary": "梳理高频告警，降低误报", "owner": "SRE", "status": "blocked", "dueDate": "2026-04-08", "progress": 18 }
  ],
  "highlights": [
    { "title": "本周完成", "desc": "模板管理（CRUD）已上线，支持新增/编辑实时预览与管理员权限控制。" },
    { "title": "风险与阻塞", "desc": "运行态告警有重复噪声，建议按错误码聚合并加阈值策略。" },
    { "title": "下周计划", "desc": "补齐模板变量约定（schema）与常用上下文注入（如用户/工作流信息）。" }
  ],
  "links": [
    { "label": "打开控制台", "url": "http://localhost:325/app", "primary": true },
    { "label": "模板配置", "url": "http://localhost:325/app/templates", "primary": false },
    { "label": "工作流配置", "url": "http://localhost:325/app/workflows", "primary": false }
  ],
  "note": "这是演示模板：通过 {% for %} / {% if %} 组合，呈现现代化布局与数据驱动渲染。",
  "footerNote": "生成时间：2026-03-30 · 仅用于演示"
}$$::jsonb,
  $1,
  $1,
  1,
  1
)
ON CONFLICT (template_key) DO NOTHING
`, now)
	if err != nil {
		return fmt.Errorf("seed template: %w", err)
	}

	// demo workflow
	defaultDSL := map[string]any{
		"nodes": []any{
			map[string]any{
				"id":       "start",
				"type":     "custom",
				"position": map[string]any{"x": 80, "y": 200},
				"data": map[string]any{
					"title": "开始",
					"type":  "start",
					"config": map[string]any{
						"variables": []any{},
					},
				},
			},
		},
		"edges":    []any{},
		"viewport": map[string]any{"x": 0, "y": 0, "zoom": 1},
	}
	defaultDSLBytes, _ := json.Marshal(defaultDSL)

	var workflowID int64
	err = conn.QueryRowContext(ctx, `
INSERT INTO workflow (
  workflow_key, name, description, menu_key, status,
  current_draft_version_no, current_published_version_no,
  dsl_json, created_at, updated_at, created_by, updated_by
) VALUES (
  'demo_workflow', '示例工作流', '默认初始化工作流', 'reserve', 'active',
  1, 0,
  $1::jsonb, $2, $2, 0, 0
)
ON CONFLICT (workflow_key) DO UPDATE SET updated_at = EXCLUDED.updated_at
RETURNING id
`, string(defaultDSLBytes), now).Scan(&workflowID)
	if err != nil {
		return fmt.Errorf("seed workflow: %w", err)
	}

	_, err = conn.ExecContext(ctx, `
INSERT INTO workflow_version (workflow_id, version_no, dsl_json, created_at, updated_at)
VALUES ($1, 1, $2::jsonb, $3, $3)
ON CONFLICT (workflow_id, version_no) DO NOTHING
`, workflowID, string(defaultDSLBytes), now)
	if err != nil {
		return fmt.Errorf("seed workflow version: %w", err)
	}

	return nil
}
