/** RFC 2047 encoded-word so UTF-8 subjects do not mojibake in Gmail. */
export function encodeRfc2047(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
