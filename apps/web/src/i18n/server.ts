import { cookies } from "next/headers";
import { LANG_COOKIE, UPDOWN_COOKIE, parseLang, parseUpDown, type Lang, type Msgs, type UpDown } from "./lang";

export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

export async function getUpDown(): Promise<UpDown> {
  return parseUpDown((await cookies()).get(UPDOWN_COOKIE)?.value);
}

/** A server component's messages in the visitor's language. */
export async function getMsgs<T>(m: Msgs<T>): Promise<T> {
  return m[await getLang()];
}
