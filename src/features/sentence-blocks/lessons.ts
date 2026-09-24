// Explicitly chosen sample themes, never inferred facts about an account.
export const lessons = {
  personal: [
    [
      "Income",
      "もっと収入を増やしたい。",
      ["I want", "to increase", "my income."],
    ],
    [
      "Europe",
      "来年ヨーロッパに行きたい。",
      ["I want", "to go", "to Europe", "next year."],
    ],
    [
      "Shopify",
      "Shopifyの仕事をもっとしたい。",
      ["I want", "to do", "more Shopify projects."],
    ],
    [
      "Focus",
      "いろいろなことを同時にやろうとしている。",
      ["I am trying", "to do", "many different things", "at the same time."],
    ],
    [
      "Confidence",
      "自分で作ったものから収入を得る方法を学びたい。",
      ["I want", "to learn", "how to make money", "from what I create."],
    ],
  ],
  hard: [
    [
      "Income",
      "もっと収入を増やしたいけど、ただ働く時間を増やすだけにはしたくない。",
      [
        "I want",
        "to increase my income,",
        "but",
        "I do not want",
        "to simply work",
        "more hours.",
      ],
    ],
    [
      "Europe",
      "来年ヨーロッパに行くなら、海外でも続けられる仕事を今から作りたい。",
      [
        "If",
        "I go",
        "to Europe",
        "next year,",
        "I want",
        "to build a business",
        "that I can run",
        "from abroad.",
      ],
    ],
    [
      "Shopify",
      "見た目が良いだけでなく売上につながるものを作りたいから、Shopifyの仕事を増やしたい。",
      [
        "I want to do",
        "more Shopify projects",
        "because",
        "I want to create",
        "something that can",
        "actually generate sales,",
        "not just look good.",
      ],
    ],
    [
      "Focus",
      "いろいろやりたいけど、全部同時に進めると進捗が散漫になることがある。",
      [
        "Although",
        "I want to do",
        "many different things,",
        "trying to do everything",
        "at the same time",
        "can make my progress",
        "feel scattered.",
      ],
    ],
    [
      "Confidence",
      "自信が十分なくても、自分が作ったものから少しずつ収入を得る方法を学びたい。",
      [
        "Even if",
        "I do not feel",
        "completely confident,",
        "I want to gradually learn",
        "how to make money",
        "from what I create.",
      ],
    ],
  ],
} satisfies Record<string, [string, string, string[]][]>;
