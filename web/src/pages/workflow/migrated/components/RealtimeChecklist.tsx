import { Alert, Button, Card, Space, Tag, Typography } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import SectionHeaderIcon from "./SectionHeaderIcon";

export type RealtimeChecklistIssue = {
  key: string;
  message: string;
  nodeId?: string;
};

type Props = {
  issues: RealtimeChecklistIssue[];
  onIssueClick?: (issue: RealtimeChecklistIssue) => void;
};

function RealtimeChecklist({ issues, onIssueClick }: Props) {
  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <SectionHeaderIcon icon={<WarningOutlined />} label="实时问题清单" tone={issues.length === 0 ? "green" : "orange"} />
          <Tag color={issues.length === 0 ? "success" : "error"}>{issues.length === 0 ? "通过" : `${issues.length} 项`}</Tag>
        </Space>
      }
    >
      {issues.length === 0 ? (
        <Alert type="success" showIcon message="当前未检测到问题" />
      ) : (
        <Space direction="vertical" size={4}>
          {issues.map((item) => (
            <Button
              key={item.key}
              type="text"
              danger
              style={{ justifyContent: "flex-start", textAlign: "left", paddingInline: 6 }}
              onClick={() => onIssueClick?.(item)}
              disabled={!item.nodeId}
            >
              <Typography.Text type="danger">- {item.message}</Typography.Text>
            </Button>
          ))}
        </Space>
      )}
    </Card>
  );
}

export default RealtimeChecklist;
