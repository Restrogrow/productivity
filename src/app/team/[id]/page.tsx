import { Suspense } from "react";
import TeamView from "./TeamView";

export default function Page() {
  return (
    <Suspense>
      <TeamView />
    </Suspense>
  );
}
