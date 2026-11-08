import AppKit
import Foundation

// Add equal transparent breathing room without changing the monogram.
guard CommandLine.arguments.count == 4,
      let scale = Double(CommandLine.arguments[3]), scale > 0, scale <= 1 else {
    fatalError("Usage: swift scripts/logo-inset.swift input.png output.png scale")
}
let input = URL(fileURLWithPath: CommandLine.arguments[1])
guard let data = try? Data(contentsOf: input), let source = NSBitmapImageRep(data: data),
      let image = NSImage(data: data),
      let canvas = NSBitmapImageRep(bitmapDataPlanes:nil, pixelsWide:source.pixelsWide,
        pixelsHigh:source.pixelsHigh, bitsPerSample:8, samplesPerPixel:4, hasAlpha:true,
        isPlanar:false, colorSpaceName:.deviceRGB, bytesPerRow:0, bitsPerPixel:0),
      let context = NSGraphicsContext(bitmapImageRep:canvas) else { fatalError("Invalid image") }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
let w = CGFloat(source.pixelsWide), h = CGFloat(source.pixelsHigh), s = CGFloat(scale)
context.cgContext.clear(CGRect(x:0,y:0,width:w,height:h))
image.draw(in:NSRect(x:w*(1-s)/2,y:h*(1-s)/2,width:w*s,height:h*s),
           from:.zero, operation:.copy, fraction:1)
NSGraphicsContext.restoreGraphicsState()
guard let png = canvas.representation(using:.png,properties:[:]) else { fatalError("Cannot encode PNG") }
try png.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
