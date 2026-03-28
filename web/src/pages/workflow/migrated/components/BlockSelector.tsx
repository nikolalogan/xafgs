import { Button, Drawer, Space } from "antd";
import { BlockEnum } from "../types";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (type: BlockEnum) => void;
};

const options: Array<{ label: string; value: BlockEnum }> = [
  { label: "Start", value: BlockEnum.Start },
  { label: "Input", value: BlockEnum.Input },
  { label: "LLM", value: BlockEnum.LLM },
  { label: "If/Else", value: BlockEnum.IfElse },
  { label: "End", value: BlockEnum.End },
  { label: "HTTP Request", value: BlockEnum.HttpRequest },
  { label: "Code", value: BlockEnum.Code },
  { label: "File Extractor", value: BlockEnum.FileExtractor }
];

function BlockSelector({ open, onClose, onSelect }: Props) {
  return (
    <Drawer title="Add Block" open={open} onClose={onClose} width={320} destroyOnHidden>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        {options.map((item) => (
          <Button
            key={item.value}
            style={{ justifyContent: "flex-start" }}
            onClick={() => {
              onSelect(item.value);
              onClose();
            }}
          >
            {item.label}
          </Button>
        ))}
      </Space>
    </Drawer>
  );
}

export default BlockSelector;
