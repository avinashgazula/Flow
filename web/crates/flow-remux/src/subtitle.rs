//! Text subtitles to plain text with line breaks, for the player to draw. Follows FlowKit's
//! SubtitleText (MatroskaRemuxer.swift), minus the WebVTT markup: the web player shows plain text.

use crate::codecs::TextFormat;

pub fn plain_text(raw: &[u8], format: TextFormat) -> String {
    let text = String::from_utf8_lossy(raw);
    let out = match format {
        TextFormat::Srt => strip_tags(&strip_overrides(&text)),
        TextFormat::Ass => from_ass_event(&text),
        TextFormat::WebVtt => decode_entities(&strip_tags(&text)),
    };
    tidy(&out)
}

/// Matroska ASS events are "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text".
/// Vector drawings (signs drawn with \p1) aren't text, so they're dropped.
fn from_ass_event(s: &str) -> String {
    let fields: Vec<&str> = s.splitn(9, ',').collect();
    let text = if fields.len() == 9 { fields[8] } else { s };
    let bytes = text.as_bytes();
    if bytes.windows(3).any(|w| w[0] == b'\\' && w[1] == b'p' && (b'1'..=b'9').contains(&w[2])) {
        return String::new();
    }
    strip_overrides(text).replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
}

/// Removes ASS override blocks: "{\i1}Hello{\i0}" → "Hello".
fn strip_overrides(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        match rest[open..].find('}') {
            Some(close) => rest = &rest[open + close + 1..],
            None => {
                rest = &rest[open..];
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Removes markup tags (<i>, </font>, <c.yellow>, <00:00:01.000>) but leaves a lone "<" in text.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let looks_like_tag = after.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '/');
        match (looks_like_tag, after.find('>')) {
            (true, Some(close)) => rest = &after[close + 1..],
            _ => {
                out.push('<');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", "\u{a0}").replace("&lrm;", "\u{200e}").replace("&rlm;", "\u{200f}").replace("&amp;", "&")
}

/// Unix line breaks, no blank or padded lines.
fn tidy(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n").split('\n').map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ass(s: &str) -> String {
        plain_text(s.as_bytes(), TextFormat::Ass)
    }

    #[test]
    fn ass_events_become_plain_lines() {
        assert_eq!(ass(r"1,0,Default,,0,0,0,,{\i1}Whispering{\i0} loudly\Nnext line"), "Whispering loudly\nnext line");
        assert_eq!(ass(r"0,0,Default,,0,0,0,,{\i1}Hello{\i0}\Nthere, friend"), "Hello\nthere, friend");
        assert_eq!(ass(r"1,0,Default,,0,0,0,,{\pos(10,20)\fad(200,200)}Plain"), "Plain");
        assert_eq!(ass(r"1,0,Sign,,0,0,0,,{\p1}m 0 0 l 100 0 100 100 0 100{\p0}"), "");
        assert_eq!(ass(r"1,0,Default,,0,0,0,,Tom & Jerry <3"), "Tom & Jerry <3");
        assert_eq!(ass(r"1,0,Default,,0,0,0,,Non\hbreaking"), "Non breaking");
    }

    #[test]
    fn srt_and_webvtt_lose_their_markup() {
        assert_eq!(plain_text(b"<i>Hello</i> <font color=\"red\">there</font> & a --> b", TextFormat::Srt), "Hello there & a --> b");
        assert_eq!(plain_text(b"{\\an8}<B>Loud</B>\r\nSecond line\r\n", TextFormat::Srt), "Loud\nSecond line");
        assert_eq!(plain_text(b"1 < 2", TextFormat::Srt), "1 < 2");
        assert_eq!(plain_text(b"<v Roger>Hi &amp; <c.yellow>bye</c> &lt;3", TextFormat::WebVtt), "Hi & bye <3");
    }
}
