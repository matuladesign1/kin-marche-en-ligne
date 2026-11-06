package expo.modules.kinvision

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Lecture du texte d'une photo sur le téléphone (Google ML Kit, modèle intégré à l'application) :
// gratuit, sans compte Google Cloud, sans Internet. Sert à lire la marque et le nom sur l'emballage
// pour la recherche par photo.
class KinVisionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("KinVision")

    AsyncFunction("recognizeText") { uri: String, promise: Promise ->
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (e: Exception) {
        promise.reject("ERR_IMAGE", e.message ?: "Photo illisible", e)
        return@AsyncFunction
      }
      val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      recognizer.process(image)
        .addOnSuccessListener { result ->
          // Chaque mot avec sa hauteur : les grands mots (la marque) comptent plus.
          val words = ArrayList<Map<String, Any>>()
          for (block in result.textBlocks) {
            for (line in block.lines) {
              for (element in line.elements) {
                words.add(mapOf("text" to element.text, "height" to (element.boundingBox?.height() ?: 0)))
              }
            }
          }
          promise.resolve(mapOf("text" to result.text, "words" to words, "width" to image.width, "height" to image.height))
          recognizer.close()
        }
        .addOnFailureListener { e ->
          promise.reject("ERR_OCR", e.message ?: "Lecture impossible", e)
          recognizer.close()
        }
    }
  }
}
