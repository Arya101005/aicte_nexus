import { NextResponse } from "next/server";

/** Authentication removed. All pages are accessible without login. */
export function proxy() {
  return NextResponse.next();
}
