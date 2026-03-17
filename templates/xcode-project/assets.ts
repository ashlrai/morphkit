// Template for generating Assets.xcassets structure

export function generateAssetsCatalog(): string {
  return JSON.stringify({
    info: {
      author: 'xcode',
      version: 1,
    },
  }, null, 2);
}

export function generateAccentColorSet(hexColor: string): {
  contents: string;
} {
  const rgb = hexToRgb(hexColor);

  return {
    contents: JSON.stringify({
      colors: [
        {
          color: {
            'color-space': 'srgb',
            components: {
              alpha: '1.000',
              blue: `${(rgb.b / 255).toFixed(3)}`,
              green: `${(rgb.g / 255).toFixed(3)}`,
              red: `${(rgb.r / 255).toFixed(3)}`,
            },
          },
          idiom: 'universal',
        },
      ],
      info: {
        author: 'xcode',
        version: 1,
      },
    }, null, 2),
  };
}

export function generateAppIconSet(): string {
  return JSON.stringify({
    images: [
      {
        idiom: 'universal',
        platform: 'ios',
        size: '1024x1024',
      },
    ],
    info: {
      author: 'xcode',
      version: 1,
    },
  }, null, 2);
}

export function generateColorSet(name: string, lightHex: string, darkHex?: string): string {
  const lightRgb = hexToRgb(lightHex);
  const colors: any[] = [
    {
      color: {
        'color-space': 'srgb',
        components: {
          alpha: '1.000',
          blue: `${(lightRgb.b / 255).toFixed(3)}`,
          green: `${(lightRgb.g / 255).toFixed(3)}`,
          red: `${(lightRgb.r / 255).toFixed(3)}`,
        },
      },
      idiom: 'universal',
    },
  ];

  if (darkHex) {
    const darkRgb = hexToRgb(darkHex);
    colors.push({
      appearances: [
        {
          appearance: 'luminosity',
          value: 'dark',
        },
      ],
      color: {
        'color-space': 'srgb',
        components: {
          alpha: '1.000',
          blue: `${(darkRgb.b / 255).toFixed(3)}`,
          green: `${(darkRgb.g / 255).toFixed(3)}`,
          red: `${(darkRgb.r / 255).toFixed(3)}`,
        },
      },
      idiom: 'universal',
    });
  }

  return JSON.stringify({
    colors,
    info: {
      author: 'xcode',
      version: 1,
    },
  }, null, 2);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}
