import { Card, Col, Row, Statistic, Typography } from "antd";

function DashboardPage() {
  return (
    <Row gutter={[16, 16]}>
      <Col span={24}>
        <Card>
          <Typography.Title level={4} style={{ marginBottom: 8 }}>
            欢迎进入控制台
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            这里是基于 Ant Design Pro 的基础框架页，可继续扩展业务菜单、权限和页面模块。
          </Typography.Paragraph>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Statistic title="在线服务" value={3} suffix="个" />
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Statistic title="今日请求" value={1289} />
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Statistic title="错误率" value={0.2} suffix="%" precision={1} />
        </Card>
      </Col>
    </Row>
  );
}

export default DashboardPage;
