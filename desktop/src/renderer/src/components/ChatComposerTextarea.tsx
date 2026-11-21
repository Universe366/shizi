interface Props {
  value: string;
  activeTab: boolean;
  sendOnEnter: boolean;
  onChange: (value: string) => void;
  onPasteImages: (files: File[]) => void;
  onMention: () => void;
  onSlash: () => void;
  onSend: () => void;
}

/** 输入区文本域：@ 引用、/ 指令、Enter 发送、图片粘贴。 */
export function ChatComposerTextarea({
  value,
  activeTab,
  sendOnEnter,
  onChange,
  onPasteImages,
  onMention,
  onSlash,
  onSend
}: Props) {
  return (
    <textarea
      className="chat-input"
      rows={2}
      value={value}
      placeholder={
        activeTab
          ? `就当前页面提问…（${sendOnEnter ? 'Enter' : 'Ctrl+Enter'} 发送）`
          : '打开网页后可用'
      }
      disabled={!activeTab}
      onChange={(event) => onChange(event.target.value)}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files || []);
        if (files.some((file) => file.type.startsWith('image/'))) {
          event.preventDefault();
          onPasteImages(files);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === '@' && (!value || /\s$/.test(value))) {
          event.preventDefault();
          onMention();
          return;
        }
        if (event.key === '/' && !value.trim()) {
          event.preventDefault();
          onSlash();
          return;
        }
        const enterSends = sendOnEnter
          ? event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey
          : event.key === 'Enter' && (event.ctrlKey || event.metaKey);
        if (enterSends) {
          event.preventDefault();
          onSend();
        }
      }}
    />
  );
}
