// swift scripts/make-icons.swift —— 生成 public/icons 下的 PWA / iOS 图标（红底白「こ」，与页面 brand-mark 一致）
import AppKit

func render(size: Int, glyphScale: CGFloat, to path: String) {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                             bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(size)
  NSColor(red: 1, green: 93 / 255, blue: 93 / 255, alpha: 1).setFill()
  NSRect(x: 0, y: 0, width: s, height: s).fill()
  let font = NSFont(name: "HiraginoSans-W6", size: s * glyphScale) ?? .boldSystemFont(ofSize: s * glyphScale)
  let text = NSAttributedString(string: "こ", attributes: [.font: font, .foregroundColor: NSColor.white])
  // 按字形实际轮廓居中，而不是按行高
  let line = CTLineCreateWithAttributedString(text)
  let ctx = NSGraphicsContext.current!.cgContext
  let b = CTLineGetImageBounds(line, ctx)
  ctx.textPosition = CGPoint(x: (s - b.width) / 2 - b.minX, y: (s - b.height) / 2 - b.minY)
  CTLineDraw(line, ctx)
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}

render(size: 180, glyphScale: 0.62, to: "public/icons/apple-touch-icon.png")
render(size: 192, glyphScale: 0.62, to: "public/icons/icon-192.png")
render(size: 512, glyphScale: 0.62, to: "public/icons/icon-512.png")
// maskable 图标会被系统裁成圆形等形状，字要缩到安全区内
render(size: 512, glyphScale: 0.44, to: "public/icons/maskable-512.png")
