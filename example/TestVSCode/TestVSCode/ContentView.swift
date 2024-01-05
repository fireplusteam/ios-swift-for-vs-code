//
//  ContentView.swift
//  TestVSCode
//
//  Created by Ievgenii Mykhalevskyi on 04.01.2024.
//

import SwiftUI

struct SomeAwesomeView: View {
    init(a: Int) {

    }

    var body: some View {
        EmptyView()
        subview
    }

    @ViewBuilder
    var subview: some View {
        Button("ok") {
            
        }
    }

    var secondView: some View {
        subview
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

        Button("Title") {
            let a = 10;
            let str = "sfdsfs"
            debugPrint("OK")
            print("ok\(a)")
        }
    }

    @ViewBuilder
    var subview: some View {
        Button("ok") {
           print("ok") 
        }
    }
}

#Preview {
    ContentView()
}
