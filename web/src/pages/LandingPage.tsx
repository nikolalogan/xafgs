import { useNavigate } from "react-router-dom";

function LandingPage() {
  const navigate = useNavigate();

  return (
    <main className="landing">
      <section className="landing-hero">
        <p className="landing-tag">Modern Web Platform</p>
        <h1>构建稳定、高效、可扩展的业务系统</h1>
        <p className="landing-desc">
          基于 React、Ant Design Pro 与 Go Fiber，提供一致的 API 规范、身份校验与可观测能力。
        </p>
        <button className="landing-cta" type="button" onClick={() => navigate("/login")}>
          开始使用
        </button>
      </section>

      <section className="landing-grid">
        <article>
          <h3>统一接口规范</h3>
          <p>统一响应格式、错误码和请求追踪 ID，提升前后端协作效率。</p>
        </article>
        <article>
          <h3>安全身份校验</h3>
          <p>基于 Bearer Token 的认证流程，支持后续接入更完整的权限模型。</p>
        </article>
        <article>
          <h3>工程化部署</h3>
          <p>Docker 一键启动开发与生产环境，快速落地、易于扩展。</p>
        </article>
      </section>
    </main>
  );
}

export default LandingPage;
