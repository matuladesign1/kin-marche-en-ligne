package expo.modules.kincall

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KinCallModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("KinCall")

    Function("showIncomingCall") { title: String, body: String, timeoutMs: Double ->
      KinCall.show(context, title, body, timeoutMs.toLong())
    }

    Function("cancelIncomingCall") {
      KinCall.cancel(context)
    }

    Function("showOverLockScreen") {
      appContext.currentActivity?.let { KinCall.showOverLockScreen(it) }
    }

    Function("releaseLockScreen") {
      appContext.currentActivity?.let { KinCall.releaseLockScreen(it) }
    }

    Function("canUseFullScreenIntent") {
      KinCall.canUseFullScreenIntent(context)
    }

    Function("openFullScreenSettings") {
      KinCall.openFullScreenSettings(context)
    }
  }
}
