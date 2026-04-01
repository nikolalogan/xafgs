package repository

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"sxfgssever/server/internal/model"
)

type TemplateRepository interface {
	FindByID(templateID int64) (model.TemplateDTO, bool)
	FindEntityByID(templateID int64) (model.Template, bool)
	FindByTemplateKey(templateKey string) (model.Template, bool)
	FindAll() []model.TemplateDTO
	Create(template model.Template) model.TemplateDTO
	Update(templateID int64, update model.Template) (model.TemplateDTO, bool)
	Delete(templateID int64) bool
}

type templateRepository struct {
	templates      map[int64]model.Template
	nextTemplateID int64
}

func NewTemplateRepository() TemplateRepository {
	now := time.Now().UTC()
	defaultContext, _ := json.Marshal(map[string]any{
		"title":    "周报概览",
		"brand":    "SXFG 运营中心",
		"subtitle": "现代化模板示例（gonja / Jinja2 语法）",
		"period": map[string]any{
			"start": "2026-03-24",
			"end":   "2026-03-30",
		},
		"user": map[string]any{
			"name":      "默认管理员",
			"roleLabel": "管理员",
		},
		"kpis": []any{
			map[string]any{"label": "活跃工作流", "value": "18", "delta": "+12%", "trend": "up", "note": "较上周"},
			map[string]any{"label": "成功执行", "value": "3,482", "delta": "+6%", "trend": "up", "note": "较上周"},
			map[string]any{"label": "失败率", "value": "0.42%", "delta": "-0.08%", "trend": "down", "note": "较上周"},
			map[string]any{"label": "平均耗时", "value": "187ms", "delta": "-14ms", "trend": "down", "note": "较上周"},
		},
		"items": []any{
			map[string]any{"name": "工作流发布窗口", "summary": "统一发布策略与回滚流程", "owner": "平台组", "status": "ok", "dueDate": "2026-04-02", "progress": 72},
			map[string]any{"name": "通知模版迁移", "summary": "迁移历史模版并补齐预览上下文", "owner": "业务组", "status": "warning", "dueDate": "2026-04-05", "progress": 45},
			map[string]any{"name": "运行时告警治理", "summary": "梳理高频告警，降低误报", "owner": "SRE", "status": "blocked", "dueDate": "2026-04-08", "progress": 18},
		},
		"highlights": []any{
			map[string]any{"title": "本周完成", "desc": "模板管理（CRUD）已上线，支持新增/编辑实时预览与管理员权限控制。"},
			map[string]any{"title": "风险与阻塞", "desc": "运行态告警有重复噪声，建议按错误码聚合并加阈值策略。"},
			map[string]any{"title": "下周计划", "desc": "补齐模板变量约定（schema）与常用上下文注入（如用户/工作流信息）。"},
		},
		"links": []any{
			map[string]any{"label": "打开控制台", "url": "http://localhost:325/app", "primary": true},
			map[string]any{"label": "模板配置", "url": "http://localhost:325/app/templates", "primary": false},
			map[string]any{"label": "工作流配置", "url": "http://localhost:325/app/workflows", "primary": false},
		},
		"note":       "这是演示模板：通过 {% for %} / {% if %} 组合，呈现现代化布局与数据驱动渲染。",
		"footerNote": "生成时间：2026-03-30 · 仅用于演示",
	})
	admissionContext, _ := json.Marshal(map[string]any{
		"title":    "准入结果",
		"decision": "reject",
		"msg":      "不通过准入：触发2条硬性规则",
		"rule": []any{
			map[string]any{
				"no":       1,
				"level":    "hard",
				"hit":      true,
				"ok":       false,
				"rule":     "地级市一般预算收入低于50亿元",
				"group":    "发行主体\n所在区域",
				"category": "集团制度",
				"remark":   "以预警通信息为准",
			},
			map[string]any{
				"no":       2,
				"level":    "guidance",
				"hit":      true,
				"ok":       false,
				"rule":     "区县级一般预算收入低于20亿元",
				"group":    "",
				"category": "评审部窗口指导",
				"remark":   "以预警通信息为准",
			},
			map[string]any{
				"no":       9,
				"level":    "hard",
				"hit":      true,
				"ok":       false,
				"rule":     "申请人持续经营时间未满1年（若申请人核心子公司持续经营超过1年，可予以豁免）",
				"group":    "",
				"category": "集团制度",
				"remark":   "底层资产符合要求的资产证券化业务不适用",
			},
		},
	})
	return &templateRepository{
		templates: map[int64]model.Template{
			1: {
				BaseEntity: model.BaseEntity{
					ID:        1,
					CreatedAt: now,
					UpdatedAt: now,
					CreatedBy: 1,
					UpdatedBy: 1,
				},
				TemplateKey:        "demo_template",
				Name:               "示例模板",
				Description:        "用于演示 Jinja2 模板渲染与预览（现代化页面）",
				Engine:             model.TemplateEngineJinja2,
				OutputType:         model.TemplateOutputTypeHTML,
				Status:             model.TemplateStatusActive,
				Content: `<!doctype html>
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
        --border: rgba(255,255,255,0.12);
        --text: rgba(255,255,255,0.92);
        --muted: rgba(255,255,255,0.68);
        --muted2: rgba(255,255,255,0.52);
        --ok: #22c55e;
        --warn: #f59e0b;
        --bad: #ef4444;
        --shadow: 0 20px 60px rgba(0,0,0,0.35);
        --radius: 18px;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        color: var(--text);
        background:
          radial-gradient(1200px 600px at 20% 10%, rgba(96,165,250,0.28), transparent 55%),
          radial-gradient(900px 500px at 80% 20%, rgba(167,139,250,0.22), transparent 55%),
          linear-gradient(180deg, var(--bg0), var(--bg1));
        min-height: 100vh;
      }
      .wrap { max-width: 1040px; margin: 0 auto; padding: 28px 16px 40px; }
      .topbar {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 16px 18px;
        background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
        box-shadow: var(--shadow); backdrop-filter: blur(10px);
      }
      .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .logo {
        width: 42px; height: 42px; border-radius: 14px;
        background: linear-gradient(135deg, rgba(96,165,250,0.9), rgba(167,139,250,0.9));
        flex: none;
      }
      .brand h1 { margin: 0; font-size: 14px; }
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
      .kpi .value { font-size: 22px; margin-top: 8px; font-weight: 700; }
      .kpi .meta { margin-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .delta { padding: 6px 10px; border-radius: 999px; font-size: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); }
      .delta.up { color: rgba(34,197,94,0.95); }
      .delta.down { color: rgba(239,68,68,0.95); }
      .main { grid-template-columns: repeat(12, 1fr); }
      .left { grid-column: span 7; }
      .right { grid-column: span 5; }
      .section-title { font-size: 13px; color: var(--muted); margin: 0 0 10px; }
      .table { width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 14px; border: 1px solid var(--border); background: rgba(255,255,255,0.04); overflow: hidden; }
      .table th, .table td { text-align: left; padding: 10px 12px; font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.07); }
      .table th { color: var(--muted); font-weight: 600; background: rgba(255,255,255,0.04); }
      .table tr:last-child td { border-bottom: none; }
      .status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; font-size: 12px; border: 1px solid var(--border); background: rgba(255,255,255,0.06); }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted2); }
      .status.ok .dot { background: var(--ok); }
      .status.warning .dot { background: var(--warn); }
      .status.blocked .dot { background: var(--bad); }
      .progress { height: 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10); background: rgba(255,255,255,0.05); overflow: hidden; }
      .bar { height: 100%; background: linear-gradient(90deg, rgba(96,165,250,0.95), rgba(167,139,250,0.95)); width: 0%; }
      .list { display: grid; gap: 10px; }
      .item { padding: 12px; border-radius: 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10); }
      .item h3 { margin: 0; font-size: 13px; }
      .item p { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
      .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
      .btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: var(--text); font-size: 12px; }
      .btn.primary { background: linear-gradient(135deg, rgba(96,165,250,0.95), rgba(167,139,250,0.95)); border-color: rgba(255,255,255,0.18); }
      .footer { margin-top: 14px; color: var(--muted2); font-size: 12px; text-align: center; }
      @media (max-width: 980px) { .kpi { grid-column: span 6; } .left, .right { grid-column: span 12; } }
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
</html>`,
				DefaultContextJSON: defaultContext,
			},
			2: {
				BaseEntity: model.BaseEntity{
					ID:        2,
					CreatedAt: now,
					UpdatedAt: now,
					CreatedBy: 1,
					UpdatedBy: 1,
				},
				TemplateKey:        "admission-template-modern",
				Name:               "准入结果模板（精简）",
				Description:        "准入结果/命中规则展示（精简样式）",
				Engine:             model.TemplateEngineJinja2,
				OutputType:         model.TemplateOutputTypeHTML,
				Status:             model.TemplateStatusActive,
				Content: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{% if title is defined and title %}{{ title }}{% else %}准入结果{% endif %}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto}
    body{min-height:100vh;display:grid;place-items:center;background:#f8fafc;padding:24px}
    .clean{max-width:680px;width:100%;background:white;border-radius:28px;padding:36px}
    .state{font-size:24px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:10px}
    .allow{color:#059669}
    .deny{color:#dc2626}
    .msg{font-size:16px;color:#475569;margin-bottom:32px;padding-bottom:20px;border-bottom:1px solid #e2e8f0}
    .rule-item{padding:20px;border-radius:18px;background:#fafafa;margin-bottom:14px}
    .rule-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
    .rule-no{font-weight:700;color:#1e293b;font-size:16px}
    .rule-level{padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600}
    .level-hard{background:#fef2f2;color:#dc2626}
    .level-guidance{background:#fffbeb;color:#d97706}
    .rule-text{font-size:15px;color:#1e293b;margin-bottom:8px;line-height:1.5}
    .rule-meta{font-size:13px;color:#64748b;display:flex;flex-wrap:wrap;gap:12px;margin-top:6px}
    .meta-label{color:#94a3b8}
  </style>
</head>
<body>
  {% set _passed = false %}
  {% if decision is defined %}
    {% if decision == "approve" or decision == "pass" or decision == "allow" %}
      {% set _passed = true %}
    {% endif %}
  {% endif %}

  {% set _message = "" %}
  {% if msg is defined %}{% set _message = msg %}{% endif %}

  {% set _rules = [] %}
  {% if rule is defined %}{% set _rules = rule %}{% endif %}

  <div class="clean">
    {% if _passed %}
      <div class="state allow">✅ 准入</div>
    {% else %}
      <div class="state deny">❌ 未准入</div>
    {% endif %}

    {% if _message %}
      <div class="msg">{{ _message }}</div>
    {% endif %}

    {% if _rules|length > 0 %}
      <div class="rule-list">
        {% for r in _rules %}
          {% if r.level is defined and r.level == "hard" %}
            {% set _no = loop.index %}
            {% if r.no is defined %}{% set _no = r.no %}{% endif %}

            {% set _level = "" %}
            {% if r.level is defined %}{% set _level = r.level %}{% endif %}

            {% set _levelLabel = "" %}
            {% if r.levelLabel is defined %}{% set _levelLabel = r.levelLabel %}{% endif %}

            {% set _text = "" %}
            {% if r.rule is defined %}{% set _text = r.rule %}{% endif %}

            {% set _group = "" %}
            {% if r.group is defined %}{% set _group = r.group %}{% endif %}

            {% set _category = "" %}
            {% if r.category is defined %}{% set _category = r.category %}{% endif %}

            {% set _remark = "" %}
            {% if r.remark is defined %}{% set _remark = r.remark %}{% endif %}

            <div class="rule-item">
              <div class="rule-header">
                <div class="rule-no">规则 #{{ _no }}</div>

                {% if _levelLabel %}
                  {% set _tag = _levelLabel %}
                {% elif _level == "hard" %}
                  {% set _tag = "硬性规则" %}
                {% elif _level == "guidance" %}
                  {% set _tag = "窗口指导" %}
                {% else %}
                  {% set _tag = "规则" %}
                {% endif %}

                <div class="rule-level {% if _level == 'hard' %}level-hard{% elif _level == 'guidance' %}level-guidance{% endif %}">
                  {{ _tag }}
                </div>
              </div>

              {% if _text %}
                <div class="rule-text">{{ _text }}</div>
              {% endif %}

              {% if _group or _category or _remark %}
                <div class="rule-meta">
                  {% if _group %}<span><span class="meta-label">分组：</span>{{ _group }}</span>{% endif %}
                  {% if _category %}<span><span class="meta-label">分类：</span>{{ _category }}</span>{% endif %}
                  {% if _remark %}<span><span class="meta-label">备注：</span>{{ _remark }}</span>{% endif %}
                </div>
              {% endif %}
            </div>
          {% endif %}
        {% endfor %}

        {% for r in _rules %}
          {% if r.level is defined and r.level == "guidance" %}
            {% set _no = loop.index %}
            {% if r.no is defined %}{% set _no = r.no %}{% endif %}

            {% set _level = "" %}
            {% if r.level is defined %}{% set _level = r.level %}{% endif %}

            {% set _levelLabel = "" %}
            {% if r.levelLabel is defined %}{% set _levelLabel = r.levelLabel %}{% endif %}

            {% set _text = "" %}
            {% if r.rule is defined %}{% set _text = r.rule %}{% endif %}

            {% set _group = "" %}
            {% if r.group is defined %}{% set _group = r.group %}{% endif %}

            {% set _category = "" %}
            {% if r.category is defined %}{% set _category = r.category %}{% endif %}

            {% set _remark = "" %}
            {% if r.remark is defined %}{% set _remark = r.remark %}{% endif %}

            <div class="rule-item">
              <div class="rule-header">
                <div class="rule-no">规则 #{{ _no }}</div>

                {% if _levelLabel %}
                  {% set _tag = _levelLabel %}
                {% elif _level == "hard" %}
                  {% set _tag = "硬性规则" %}
                {% elif _level == "guidance" %}
                  {% set _tag = "窗口指导" %}
                {% else %}
                  {% set _tag = "规则" %}
                {% endif %}

                <div class="rule-level {% if _level == 'hard' %}level-hard{% elif _level == 'guidance' %}level-guidance{% endif %}">
                  {{ _tag }}
                </div>
              </div>

              {% if _text %}
                <div class="rule-text">{{ _text }}</div>
              {% endif %}

              {% if _group or _category or _remark %}
                <div class="rule-meta">
                  {% if _group %}<span><span class="meta-label">分组：</span>{{ _group }}</span>{% endif %}
                  {% if _category %}<span><span class="meta-label">分类：</span>{{ _category }}</span>{% endif %}
                  {% if _remark %}<span><span class="meta-label">备注：</span>{{ _remark }}</span>{% endif %}
                </div>
              {% endif %}
            </div>
          {% endif %}
        {% endfor %}

        {% for r in _rules %}
          {% if r.level is not defined or r.level != "hard" and r.level != "guidance" %}
            {% set _no = loop.index %}
            {% if r.no is defined %}{% set _no = r.no %}{% endif %}

            {% set _level = "" %}
            {% if r.level is defined %}{% set _level = r.level %}{% endif %}

            {% set _levelLabel = "" %}
            {% if r.levelLabel is defined %}{% set _levelLabel = r.levelLabel %}{% endif %}

            {% set _text = "" %}
            {% if r.rule is defined %}{% set _text = r.rule %}{% endif %}

            {% set _group = "" %}
            {% if r.group is defined %}{% set _group = r.group %}{% endif %}

            {% set _category = "" %}
            {% if r.category is defined %}{% set _category = r.category %}{% endif %}

            {% set _remark = "" %}
            {% if r.remark is defined %}{% set _remark = r.remark %}{% endif %}

            <div class="rule-item">
              <div class="rule-header">
                <div class="rule-no">规则 #{{ _no }}</div>

                {% if _levelLabel %}
                  {% set _tag = _levelLabel %}
                {% elif _level == "hard" %}
                  {% set _tag = "硬性规则" %}
                {% elif _level == "guidance" %}
                  {% set _tag = "窗口指导" %}
                {% else %}
                  {% set _tag = "规则" %}
                {% endif %}

                <div class="rule-level {% if _level == 'hard' %}level-hard{% elif _level == 'guidance' %}level-guidance{% endif %}">
                  {{ _tag }}
                </div>
              </div>

              {% if _text %}
                <div class="rule-text">{{ _text }}</div>
              {% endif %}

              {% if _group or _category or _remark %}
                <div class="rule-meta">
                  {% if _group %}<span><span class="meta-label">分组：</span>{{ _group }}</span>{% endif %}
                  {% if _category %}<span><span class="meta-label">分类：</span>{{ _category }}</span>{% endif %}
                  {% if _remark %}<span><span class="meta-label">备注：</span>{{ _remark }}</span>{% endif %}
                </div>
              {% endif %}
            </div>
          {% endif %}
        {% endfor %}
      </div>
    {% endif %}
  </div>
</body>
</html>`,
				DefaultContextJSON: admissionContext,
			},
		},
		nextTemplateID: 3,
	}
}

func (repository *templateRepository) FindByID(templateID int64) (model.TemplateDTO, bool) {
	template, ok := repository.templates[templateID]
	if !ok {
		return model.TemplateDTO{}, false
	}
	return template.ToDTO(), true
}

func (repository *templateRepository) FindEntityByID(templateID int64) (model.Template, bool) {
	template, ok := repository.templates[templateID]
	return template, ok
}

func (repository *templateRepository) FindByTemplateKey(templateKey string) (model.Template, bool) {
	trimmed := strings.TrimSpace(templateKey)
	if trimmed == "" {
		return model.Template{}, false
	}
	for _, template := range repository.templates {
		if template.TemplateKey == trimmed {
			return template, true
		}
	}
	return model.Template{}, false
}

func (repository *templateRepository) FindAll() []model.TemplateDTO {
	ids := make([]int64, 0, len(repository.templates))
	for templateID := range repository.templates {
		ids = append(ids, templateID)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	templates := make([]model.TemplateDTO, 0, len(ids))
	for _, templateID := range ids {
		templates = append(templates, repository.templates[templateID].ToDTO())
	}
	return templates
}

func (repository *templateRepository) Create(template model.Template) model.TemplateDTO {
	now := time.Now().UTC()
	template.ID = repository.nextTemplateID
	template.CreatedAt = now
	template.UpdatedAt = now
	repository.templates[template.ID] = template
	repository.nextTemplateID++
	return template.ToDTO()
}

func (repository *templateRepository) Update(templateID int64, update model.Template) (model.TemplateDTO, bool) {
	existing, ok := repository.templates[templateID]
	if !ok {
		return model.TemplateDTO{}, false
	}

	existing.Name = update.Name
	existing.Description = update.Description
	existing.OutputType = update.OutputType
	existing.Status = update.Status
	existing.Content = update.Content
	existing.DefaultContextJSON = update.DefaultContextJSON
	existing.UpdatedAt = time.Now().UTC()
	existing.UpdatedBy = update.UpdatedBy
	repository.templates[templateID] = existing
	return existing.ToDTO(), true
}

func (repository *templateRepository) Delete(templateID int64) bool {
	if _, ok := repository.templates[templateID]; !ok {
		return false
	}
	delete(repository.templates, templateID)
	return true
}
