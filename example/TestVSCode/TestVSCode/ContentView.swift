//
//  ContentView.swift
//  TestVSCode
//
//  Created by Ievgenii Mykhalevskyi on 04.01.2024.
//

import SwiftUI

struct SomeAwesomeView: View {
    @State var po: Int = 10
    init(a: Int) {

    }

    var body: some View {
        EmptyView()
        subview
    }

    @ViewBuilder
    var subview: some View {
        Button("ok") {
            let b = 20;
            print("\(b) WOW PRINT WAY DOWN")
            debugPrint("WOW DEBUG PRINT")
            callMethod();
            NSLog("WOW this is working")
        }
    }

    var secondView: some View {
        subview
    }

    func callMethod() {
        let a = 10;
        print("\(a),\(self.po)")
    }
}

struct ContentView: View {
    var body: some View {
        VStack {
            SomeAwesomeView(a: 20)
            Image(systemName: "globe")
                .imageScale(.large)
                .foregroundStyle(.tint)
            Text("Hello, world!")

            SomeAwesomeView(a: 10)
        }
        .padding()

        Button("Title") { [self]
            let a = 10;
            let str = "sfdsfs"
            debugPrint("OK")
            print("ok\(a)\(self)")
        }
    }

    @ViewBuilder
    var subview: some View {
        Button("ok") {
           print("ok") 
        }
    }
}

//#Preview {
    //ContentView()
//}
