#!/bin/bash
cd "D:/下载/新建文件夹" || exit 1
urls="https://ibb.co/nPYqtm https://ibb.co/5hY6V1v https://ibb.co/JvCCrgN https://ibb.co/yqLMbsY https://ibb.co/TPCTKRQ https://ibb.co/m6k0gD8 https://ibb.co/4YS4K8D https://ibb.co/ctpZGZN https://ibb.co/TTBjs3h https://ibb.co/cxQjchB https://ibb.co/7C0XXNv https://ibb.co/F8Dxd4f https://ibb.co/tPSq7vC https://ibb.co/G2n6Py0 https://ibb.co/5kX8h0t https://ibb.co/Mf79zKd https://ibb.co/2PVfsyf https://ibb.co/tHPDYtQ https://ibb.co/16fJfWS https://ibb.co/rkC4PJL https://ibb.co/4tJyBcZ https://ibb.co/T8Qfbvb https://ibb.co/vmXJG6h https://ibb.co/K2qFz9j https://ibb.co/RCw3SBn https://ibb.co/2M66351 https://ibb.co/ZW6Dwy0 https://ibb.co/R3xmxPv https://ibb.co/vLSCkdd https://ibb.co/nkrT5qw https://ibb.co/2KxdFK9 https://ibb.co/1b7cFzN https://ibb.co/mNC6yq9 https://ibb.co/nMhsyvt https://ibb.co/5L3m3jT https://ibb.co/p1F0Tj7 https://ibb.co/1nCsNpm https://ibb.co/tb7VbwV https://ibb.co/hX3mc5k https://ibb.co/6WmyT8h https://ibb.co/YcqVhVC https://ibb.co/HKPjVxb https://ibb.co/fX3NDWT https://ibb.co/X8dCnym https://ibb.co/52ng39s https://ibb.co/PFSKt0S https://ibb.co/M83JYD9 https://ibb.co/ZSzpp6j https://ibb.co/j5cKFwg https://ibb.co/gvcyF5B https://ibb.co/pLM1DQx https://ibb.co/G5NLYX7 https://ibb.co/zZP9j9r https://ibb.co/f0VrJrm https://ibb.co/PQhpm5q https://ibb.co/k5G641V https://ibb.co/GRpsfM6 https://ibb.co/xC28RVX https://ibb.co/23BTFkq https://ibb.co/4gw3JZd https://ibb.co/q5tymQV https://ibb.co/QnnH31p https://ibb.co/4tBP2xh https://ibb.co/tx6ynf4 https://ibb.co/VSH3BMh https://ibb.co/4mCVDDr https://ibb.co/z2wytRP https://ibb.co/nmY6M3L https://ibb.co/qRWKwYS https://ibb.co/whdMygS https://ibb.co/NrwvSFb https://ibb.co/SxkBKwJ https://ibb.co/qpq0QQg https://ibb.co/3dVM7fm https://ibb.co/XV3y8mC https://ibb.co/4Fv1KF5 https://ibb.co/QD8MB3x https://ibb.co/KzDjqD5 https://ibb.co/r3r8rh8 https://ibb.co/qRJp7Fc https://ibb.co/Mgp5G4n https://ibb.co/qNZWXzm https://ibb.co/nB4RJCG https://ibb.co/znnyc2z https://ibb.co/HKJwZsw https://ibb.co/x7WLk4S https://ibb.co/Xjnbnxv https://ibb.co/d48Hfks https://ibb.co/fSXSHj4 https://ibb.co/k4RRLc3 https://ibb.co/5cYfw9x https://ibb.co/zRhs6wq"
i=0
for u in $urls; do
  i=$((i+1))
  img=$(curl -sL "$u" | rg -o 'og:image" content="[^"]+' | sed 's/og:image" content="//')
  if [ -z "$img" ]; then
    echo "FAIL $i $u"
    continue
  fi
  ext="${img##*.}"
  name=$(printf "%03d.%s" "$i" "$ext")
  curl -sL -o "$name" "$img" && echo "OK $i $name $(stat -c%s "$name") bytes"
done