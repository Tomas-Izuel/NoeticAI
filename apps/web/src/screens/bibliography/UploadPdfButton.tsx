import { useRef, type FC } from "react";
import { Icon } from "./icons";

interface UploadPdfButtonProps {
  isPending: boolean;
  onFile: (file: File) => void;
}

export const UploadPdfButton: FC<UploadPdfButtonProps> = ({ isPending, onFile }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFile(file);
      // Reset so the same file can be re-selected
      e.target.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={handleChange}
        aria-label="Upload PDF file"
      />
      <button
        className="btn btn-secondary"
        onClick={() => inputRef.current?.click()}
        disabled={isPending}
      >
        <Icon name="upload" size={13} />
        {isPending ? " Uploading…" : " Upload PDF"}
      </button>
    </>
  );
};
