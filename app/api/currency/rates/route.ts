import { NextResponse } from "next/server";
import { getLiveRatesPerUsd } from "@/lib/currency";

export async function GET() {
  const { rates, source, fetchedAt } = await getLiveRatesPerUsd();
  return NextResponse.json({ base: "USD", rates, source, fetchedAt });
}