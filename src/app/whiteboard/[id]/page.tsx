import { Suspense } from "react";
import WhiteboardView from "./WhiteboardView";

export default function Page() {
  return (
    <Suspense>
      <WhiteboardView />
    </Suspense>
  );
}