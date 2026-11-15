# Google Play listing (French default, English translation)

App name: **Reymenta**
Category: Music & Audio (or Entertainment). Contains ads: no. In-app purchases: no. Target audience: 13+.
Privacy policy: https://assets.batchass.fr/reymenta/privacy.html
Graphics: `icon-512.png`, `feature-graphic-1024x500.png`, `phone/*.png` (1080x1920), `tablet-7/*.png` and `tablet-10/*.png` (1200x1920) made by `scripts/make-icons.ps1`
and `scripts/store-shots.mjs`.

## Français

**Description courte (80 caractères max)**
Jouez avec le show audiovisuel Reymenta depuis votre téléphone.

**Description complète**
Pendant les concerts audiovisuels de Reymenta, votre téléphone devient un instrument visuel.

Rejoignez le show, recevez un nom (« Loutre turquoise ») et une couleur, et prenez votre place sur l'écran géant :
• inclinez le téléphone pour déplacer votre cercle
• secouez-le pour le faire grandir
• touchez l'écran, envoyez des emojis 🔥 😍 👏
Tout le public joue ensemble : la salle entière fait bouger les images, en direct, avec la musique.

Aucun compte, aucun nom à taper, aucune publicité. Seuls des nombres quittent votre téléphone (inclinaison, toucher) et rien n'est gardé après la soirée.

Fonctionne au concert, sur le Wi-Fi de la salle ou en 4G. Français et anglais.

## English

**Short description (80 characters max)**
Play along with the Reymenta audiovisual show from your phone.

**Full description**
During Reymenta's audiovisual concerts, your phone becomes a visual instrument.

Join the show, get a name ("Teal otter") and a colour, and take your place on the big screen:
• tilt the phone to move your circle
• shake it to make it grow
• touch the screen, send emojis 🔥 😍 👏
The whole audience plays together: the room moves the visuals, live, with the music.

No account, no name to type, no ads. Only numbers leave your phone (tilt, touch) and nothing is kept after the evening.

Works at the concert, on the venue's Wi-Fi or on 4G. French and English.

## Data safety form (answers)

- Data collected: **none** stored. Data shared: **none**.
- Sent while playing, not stored: device motion values and touch position (app functionality), a random app-generated ID.
  In Play's form this is "processed ephemerally" (not collected): no personal data, no location, no identifiers tied to the
  person or device.
- Encrypted in transit: yes over the internet (wss); on a venue's local network the link to the show PC is plain ws.
- Users can request deletion: nothing is kept.

## Release steps

1. `pnpm bump` (new version), `pnpm androidrelease` -> `android/app/build/outputs/bundle/release/app-release.aab`
   (signed with the upload key `%USERPROFILE%\.android-keys\reymenta-upload.jks`, Play App Signing).
2. Play Console: create the app (Reymenta, default language French), App content (privacy policy, ads: no, data safety
   as above, target audience, content rating questionnaire), store listing (texts and graphics above).
3. **Closed testing first** (new personal developer accounts): a closed test track with **at least 12 testers opted
   in for 14 days in a row** before production can be requested. Upload the AAB there, add the testers' Google
   accounts (a Google Group is easiest), share the opt-in link.
4. After the 14 days: apply for production access, then promote the release.
