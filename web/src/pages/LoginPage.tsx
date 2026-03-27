import { useNavigate } from "react-router-dom";
import { LoginFormPage, ProFormText } from "@ant-design/pro-components";
import { message } from "antd";
import { login, setAccessToken, type ApiError } from "../api";

function LoginPage() {
  const navigate = useNavigate();

  return (
    <LoginFormPage<{ username: string; password: string }>
      title="SXFG Platform"
      subTitle="登录后进入 Ant Design Pro 管理框架"
      backgroundImageUrl="https://gw.alipayobjects.com/zos/rmsportal/FfdJeJRQWjEeGTpqgBKj.png"
      onFinish={async (values) => {
        try {
          const result = await login(values.username, values.password);
          setAccessToken(result.accessToken);
          message.success(`欢迎，${result.user.username}`);
          navigate("/app");
          return true;
        } catch (error) {
          const apiError = error as ApiError;
          message.error(`${apiError.code}: ${apiError.message}`);
          return false;
        }
      }}
    >
      <ProFormText
        name="username"
        fieldProps={{ size: "large" }}
        placeholder="请输入用户名（示例：developer）"
        rules={[{ required: true, message: "请输入用户名" }]}
      />
      <ProFormText.Password
        name="password"
        fieldProps={{ size: "large" }}
        placeholder="请输入密码（示例：123456）"
        rules={[{ required: true, message: "请输入密码" }]}
      />
    </LoginFormPage>
  );
}

export default LoginPage;
