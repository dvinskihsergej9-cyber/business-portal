import { NextRequest } from "next/server";
import { forwardAuthRequest } from "../utils";

export async function POST(request: NextRequest) {
  return forwardAuthRequest(request, "auth/reset-password");
}
