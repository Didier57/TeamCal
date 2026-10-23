import { Editor } from '@tinymce/tinymce-react';
import { useAuth } from '../app-context';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function RichTextEditor({ value, onChange, placeholder, disabled }: Props) {
  const { theme } = useAuth();
  const dark = theme === 'dark';

  return (
    <div className="rte">
      <Editor
        licenseKey="gpl"
        tinymceScriptSrc="/tinymce/tinymce.min.js"
        value={value}
        onEditorChange={(html) => onChange(html)}
        disabled={disabled}
        init={{
          base_url: '/tinymce',
          suffix: '.min',
          skin: dark ? 'oxide-dark' : 'oxide',
          content_css: dark
            ? '/tinymce/skins/content/dark/content.min.css'
            : '/tinymce/skins/content/default/content.min.css',
          height: 240,
          menubar: false,
          statusbar: false,
          branding: false,
          promotion: false,
          resize: false,
          placeholder,
          plugins: 'lists link autolink',
          toolbar: 'bold italic underline strikethrough | bullist numlist | link | removeformat',
          formats: {
            underline: { inline: 'u', exact: true },
            strikethrough: { inline: 's', exact: true }
          },
          convert_urls: false,
          link_default_protocol: 'https',
          entity_encoding: 'raw',
          content_style:
            "body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; margin: 10px; }"
        }}
      />
    </div>
  );
}
