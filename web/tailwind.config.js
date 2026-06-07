export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // 复古侦探案卷基调（暖色牛皮纸 / 案红 / 琥珀）
        ink: "#2a2017",
        steel: "#8a7763",
        line: "#d9c8a8",
        paper: "#efe5cf",
        noir: "#a3302a",
        ember: "#b5731f",
        manila: "#f3ead2",
        card: "#fbf6ea",
        cork: "#c4a064",
        kraft: "#d8c19a",
        string: "#b0342a",
        desk: "#1d1812",
        deskcard: "#2a2219"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif"
        ],
        reader: [
          "Noto Serif SC",
          "Songti SC",
          "SimSun",
          "Georgia",
          "serif"
        ]
      },
      boxShadow: {
        panel: "0 1px 2px rgba(43, 33, 18, 0.08), 0 16px 40px rgba(43, 33, 18, 0.10)",
        slip: "0 2px 3px rgba(40, 25, 12, 0.14), 0 14px 26px rgba(40, 25, 12, 0.12)"
      }
    }
  },
  plugins: []
};
