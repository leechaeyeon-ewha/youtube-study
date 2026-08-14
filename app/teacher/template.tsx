import PageTransition from "@/components/PageTransition";

export default function TeacherTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
