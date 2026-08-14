import PageTransition from "@/components/PageTransition";

export default function StudentTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
