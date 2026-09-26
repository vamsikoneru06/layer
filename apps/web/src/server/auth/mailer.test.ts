import { describe, expect, it } from "vitest";
import { gmailMailer, magicLinkEmail, resendMailer } from "./mailer";

describe("magicLinkEmail", () => {
  it("includes the link as text and as escaped HTML", () => {
    const m = magicLinkEmail("a@b.test", 'https://x.test/verify?token=abc&next="/home"');
    expect(m.text).toContain('https://x.test/verify?token=abc&next="/home"');
    expect(m.html).toContain("token=abc&amp;next=&quot;/home&quot;");
    expect(m.text).toMatch(/expires in 10 minutes/);
  });
});

describe("gmailMailer", () => {
  it("sends through the given SMTP transport as the configured sender", async () => {
    const sent: Record<string, unknown>[] = [];
    const transport = { sendMail: async (m: Record<string, unknown>) => void sent.push(m) };
    await gmailMailer({ from: "VASH <vash.app@gmail.com>" }, transport).send(magicLinkEmail("a@b.test", "https://x.test/v"));
    expect(sent[0]).toMatchObject({ from: "VASH <vash.app@gmail.com>", to: "a@b.test", subject: "Your VASH sign-in link" });
    expect(sent[0]!.html).toContain("https://x.test/v");
  });

  it("fails without echoing the SMTP server's reply", async () => {
    const transport = {
      sendMail: async () => {
        throw new Error("535-5.7.8 Username and Password not accepted for vash.app@gmail.com");
      },
    };
    const send = gmailMailer({ from: "x@y.test" }, transport).send(magicLinkEmail("a@b.test", "https://x.test/v"));
    await expect(send).rejects.toThrow("Gmail rejected the email");
    await expect(send).rejects.not.toThrow(/Password not accepted/);
  });
});

describe("resendMailer", () => {
  it("posts to the Resend API with a bearer key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await resendMailer({ apiKey: "re_test", from: "VASH <hi@vash.test>" }, fakeFetch).send(magicLinkEmail("a@b.test", "https://x.test/v"));
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ from: "VASH <hi@vash.test>", to: ["a@b.test"] });
  });

  it("fails without echoing the provider's response body", async () => {
    const fakeFetch = (async () => new Response("secret provider detail", { status: 422 })) as unknown as typeof fetch;
    const send = resendMailer({ apiKey: "re_test", from: "x@y.test" }, fakeFetch).send(magicLinkEmail("a@b.test", "https://x.test/v"));
    await expect(send).rejects.toThrow("HTTP 422");
    await expect(send).rejects.not.toThrow(/secret provider detail/);
  });
});
