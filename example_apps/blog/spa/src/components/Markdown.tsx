// Post bodies are markdown (the `body_md` column). react-markdown renders
// to React elements — no dangerouslySetInnerHTML, no raw-HTML passthrough
// (react-markdown skips embedded HTML by default, which is exactly right
// for a page that also renders other users' comments nearby).

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="post-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
