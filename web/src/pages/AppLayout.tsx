import { ApartmentOutlined, DeploymentUnitOutlined, HomeOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { PageContainer, ProLayout } from "@ant-design/pro-components";
import { Button, Space, Typography } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearAccessToken } from "../api";

const menuItems = [
  { path: "/app", name: "工作台", icon: <HomeOutlined /> },
  { path: "/app/workflow-editor", name: "工作流编辑", icon: <ApartmentOutlined /> },
  { path: "/app/dify-workflow", name: "Dify工作流", icon: <DeploymentUnitOutlined /> },
  { path: "/app/profile", name: "个人信息", icon: <UserOutlined /> }
];

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ minHeight: "100vh" }}>
      <ProLayout
        title="SXFG Console"
        location={{ pathname: location.pathname }}
        route={{ routes: menuItems }}
        menuItemRender={(item, dom) => <Link to={item.path || "/app"}>{dom}</Link>}
        avatarProps={{
          title: "Developer"
        }}
        actionsRender={() => [
          <Space key="actions" align="center">
            <Typography.Text>已登录</Typography.Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                clearAccessToken();
                navigate("/login");
              }}
            >
              退出
            </Button>
          </Space>
        ]}
      >
        <PageContainer>
          <Outlet />
        </PageContainer>
      </ProLayout>
    </div>
  );
}

export default AppLayout;
