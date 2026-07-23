#!/bin/bash
# לחיצה כפולה מפעילה את סטודיו אלבדי. אפשר להעתיק את הקובץ לשולחן העבודה.
cd ~/Projects/albadi-crm/studio || { echo "לא נמצאה תיקיית studio ב-~/Projects/albadi-crm"; read -r; exit 1; }

if [ ! -d node_modules ]; then
  echo "מתקין תלויות (פעם ראשונה בלבד)…"
  npm install || { echo "התקנה נכשלה"; read -r; exit 1; }
fi

echo ""
echo "  🎨 מפעיל את סטודיו אלבדי — השאר את החלון הזה פתוח."
echo "     פתח דרך כפתור «סטודיו» בתפריט, או http://localhost:4747"
echo "     לסגירה: Ctrl-C או סגור את החלון."
echo ""
npm start
