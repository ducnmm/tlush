import AppKit
import Foundation

// Derive the white-on-black mark from the blue logo's alpha channel.
// Geometry, canvas, holes and antialiasing remain pixel-identical.
guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: swift scripts/logo-silhouette.swift input.png output.png")
}
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSBitmapImageRep(data: try Data(contentsOf: input)),
      let target = NSBitmapImageRep(bitmapDataPlanes: nil,
        pixelsWide: source.pixelsWide, pixelsHigh: source.pixelsHigh,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let pixels = target.bitmapData else { fatalError("Cannot read or allocate PNG") }
for y in 0..<source.pixelsHigh {
    for x in 0..<source.pixelsWide {
        let alpha = UInt8((source.colorAt(x: x, y: y)!.alphaComponent * 255).rounded())
        let offset = y * target.bytesPerRow + x * 4
        pixels[offset] = alpha
        pixels[offset + 1] = alpha
        pixels[offset + 2] = alpha
        pixels[offset + 3] = 255
    }
}
guard let png = target.representation(using: .png, properties: [:]) else { fatalError("Cannot encode PNG") }
try png.write(to: output)
print("Projected alpha silhouette: \(input.lastPathComponent) → \(output.lastPathComponent)")
