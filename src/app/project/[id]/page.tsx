import { Suspense } from "react";
import ProjectView from "./ProjectView";

export default function Page() {
  return (
    <Suspense>
      <ProjectView />
    </Suspense>
  );
}
