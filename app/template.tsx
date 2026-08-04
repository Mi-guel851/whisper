import TemplateTransition from "@/components/TemplateTransition";

export default function Template({ children }: { children: React.ReactNode }) {
  return <TemplateTransition>{children}</TemplateTransition>;
}
